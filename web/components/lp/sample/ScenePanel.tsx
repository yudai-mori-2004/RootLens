"use client";

// 3D シーンパネル。 部屋のメッシュ + 全軌跡 + カメラ現在位置マーカー を 1 つの Canvas に描画する。
// - 視点は OrbitControls で自由に動かせる (パン・ズーム・回転)。 時間軸とは独立。
// - メッシュは事前生成の GLB (mesh.glb)。 世界座標に統一済みなので直接置ける。
// - 軌跡は trajectory.json (10 Hz)。 useMemo で BufferGeometry を組む。
// - 現在時刻のカメラ位置は Store の再生ヘッドを購読して、 軌跡のインデックスを線形補間で
//   引き当てて Sphere を移動させる。 これがユーザに「今どこにいるか」を可視化する。
//
// R3F は Next.js 16 の RSC と相性が悪い (client しか動かない) ので、 全体を "use client" に
// 隔離する。 useGLTF はビルド時 code split で three.js 一式が入るため、 dynamic import は不要。

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useTranslations } from "next-intl";
import { usePlayhead } from "./TimeContext";
import type { TrajectoryData } from "./types";

interface Props {
  meshUrl: string | null;
  trajectory: TrajectoryData | null;
}

export default function ScenePanel({ meshUrl, trajectory }: Props) {
  const t = useTranslations("pages.sample.empty");
  if (!meshUrl || !trajectory) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "100%", height: "100%", background: "#0b0d11", color: "#666", fontSize: 12,
      }}>
        {t("mesh")}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", background: "#0b0d11" }}>
      <Canvas camera={{ position: [4, 4, 4], fov: 50 }}>
        {/* 視点操作: 左ドラッグで回転、 右ドラッグでパン、 ホイールでズーム。 */}
        <OrbitControls makeDefault />
        <ambientLight intensity={0.55} />
        <directionalLight position={[8, 12, 6]} intensity={0.9} />

        {/* Mesh: 部屋の 3D スキャン。 マテリアルは半透明の白で「体積が見える」 状態にする。 */}
        <Suspense fallback={null}>
          <RoomMesh url={meshUrl} />
        </Suspense>

        {/* Trajectory: カメラ (装着者) が歩いた軌跡。 全経路を 1 本の Line で。 */}
        <TrajectoryLine trajectory={trajectory} />

        {/* Playhead marker: 現時刻のカメラ位置を球で示す。 */}
        <PlayheadMarker trajectory={trajectory} />

        {/* Ground grid: スケール感を掴むため。 1 m 目盛り。 */}
        <gridHelper args={[20, 20, "#333", "#222"]} position={[0, -1.5, 0]} />

        {/* 軸のガイド (= 右下の小さなキューブ)。 現在のカメラの向きに追従して回転するので、
            回した後でも どちらが X / Y / Z か即座に分かる。 色は Three.js の慣習に合わせて
            X=赤 / Y=緑 / Z=青。 */}
        <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
          <GizmoViewport
            axisColors={["#ff3d80", "#7be89c", "#5aa8ff"]}
            labelColor="#0b0d11"
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}

function RoomMesh({ url }: { url: string }) {
  const gltf = useGLTF(url);
  // gltf.scene は Object3D。 マテリアルを半透明ワイヤ入りに差し替えて、 中身が見えるようにする。
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.material = new THREE.MeshStandardMaterial({
          color: "#8fa5d8",
          metalness: 0.0,
          roughness: 0.9,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
        });
      }
    });
    return clone;
  }, [gltf.scene]);
  return <primitive object={scene} />;
}

function TrajectoryLine({ trajectory }: { trajectory: TrajectoryData }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(trajectory.poses.length * 3);
    for (let i = 0; i < trajectory.poses.length; i++) {
      const p = trajectory.poses[i].xyz;
      arr[i * 3] = p[0];
      arr[i * 3 + 1] = p[1];
      arr[i * 3 + 2] = p[2];
    }
    return arr;
  }, [trajectory]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  const material = useMemo(() => new THREE.LineBasicMaterial({ color: "#ffe600", linewidth: 2 }), []);

  return <primitive object={new THREE.Line(geometry, material)} />;
}

function PlayheadMarker({ trajectory }: { trajectory: TrajectoryData }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const state = usePlayhead();

  // 各フレームで t (秒) → 姿勢 (xyz + quat) の線形補間を計算し、 マーカーを移動。
  // useFrame は rAF ベース (~60 Hz)。 usePlayhead で state を購読しているので、
  // t が変わったら再描画される。
  useFrame(() => {
    if (!meshRef.current) return;
    const t_ms = state.t * 1000;
    const poses = trajectory.poses;
    if (!poses.length) return;
    // 二分探索の代わりに単純な線形探索 (10 Hz サンプルなので大した本数じゃない)。
    let i = 0;
    while (i < poses.length - 1 && poses[i + 1].t <= t_ms) i++;
    const p0 = poses[i];
    const p1 = poses[Math.min(i + 1, poses.length - 1)];
    const span = Math.max(1, p1.t - p0.t);
    const alpha = Math.max(0, Math.min(1, (t_ms - p0.t) / span));
    const x = p0.xyz[0] + (p1.xyz[0] - p0.xyz[0]) * alpha;
    const y = p0.xyz[1] + (p1.xyz[1] - p0.xyz[1]) * alpha;
    const z = p0.xyz[2] + (p1.xyz[2] - p0.xyz[2]) * alpha;
    meshRef.current.position.set(x, y, z);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.08, 24, 16]} />
      <meshBasicMaterial color="#ff3d80" />
    </mesh>
  );
}

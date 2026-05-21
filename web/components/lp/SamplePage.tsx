import fs from "fs";
import path from "path";
import { getTranslations } from "next-intl/server";
import s from "./lp.module.css";
import { EpisodeListClient } from "./EpisodeListClient";
import { SyncedVideoPair } from "./SyncedVideoPair";

const R2_PUBLIC = "https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev/lp-sample/v0.1";
const ZIP_URL = `${R2_PUBLIC}/rootlens-sample-v0.1.zip`;

const TAGS = ["robotics", "egocentric", "first-person", "household", "hand-pose", "mano", "c2pa", "lerobot"];

const DIR_TREE = `<root>/
├── meta/
│   ├── info.json
│   ├── tasks.jsonl
│   ├── stats.json
│   └── episodes/chunk-000/file-000.parquet
├── data/chunk-000/file-000.parquet
└── videos/observation.images.ego_cam/chunk-000/
    ├── episode_000.mp4
    ├── episode_001.mp4
    └── ...`;

const LOADING_CODE = `import pyarrow.parquet as pq

data = pq.read_table("data/chunk-000/file-000.parquet")
print(data.column_names)
# ['timestamp', 'frame_index', 'episode_index', 'index',
#  'task_index', 'observation.hand_pose_mano', ...]`;

interface Phase {
  start_sec: number;
  end_sec: number;
  text: string;
}

interface Episode {
  index: number;
  video_id: string;
  category: string;
  region: string;
  duration_sec: number;
  length_frames: number;
  task: string;
  phases: Phase[];
}

interface EpisodesDoc {
  fps: number;
  total_episodes: number;
  episodes: Episode[];
}

function loadEpisodes(): EpisodesDoc {
  const p = path.join(process.cwd(), "public", "lp", "sample", "json", "dataset_episodes.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as EpisodesDoc;
}

function videoUrl(idx: number): string {
  return `${R2_PUBLIC}/videos/observation.images.ego_cam/chunk-000/episode_${String(idx).padStart(3, "0")}.mp4`;
}

function skeletonUrl(idx: number): string {
  return `${R2_PUBLIC}/skeleton/episode_${String(idx).padStart(3, "0")}_skeleton.mp4`;
}

function fmtTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const rs = sec - m * 60;
  return m > 0 ? `${m}:${rs.toFixed(1).padStart(4, "0")}` : `${rs.toFixed(1)}s`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineCode(str: string): string {
  return escapeHtml(str).replace(/`([^`]+)`/g, "<code>$1</code>");
}

export default async function SamplePage() {
  const t = await getTranslations("pages.sample");
  const doc = loadEpisodes();

  const totalFrames = doc.episodes.reduce((sum, ep) => sum + ep.length_frames, 0);
  const totalLabels = 188;

  const stats: [string, string][] = [
    [t("statEpisodes"), String(doc.total_episodes)],
    [t("statFrames"), new Intl.NumberFormat("en-US").format(totalFrames)],
    [t("statLabels"), String(totalLabels)],
    [t("statFps"), String(doc.fps)],
    [t("statResolution"), "1920 × 1080"],
    [t("statCodec"), "H.264 / AVC"],
    [t("statSize"), "~560 MB"],
    [t("statRegion"), "Japan"],
    [t("statViewpoint"), "Head-mounted, first-person"],
    [t("statFormat"), "LeRobotDataset v3.0"],
  ];

  return (
    <div className={s.page}>
      {/* Page-level intro */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h1 className={s.sectionTitle}>{t("pageTitle")}</h1>
          <p className={s.prose}>{t("pageIntro")}</p>
        </div>
      </section>

      {/* v0.1 Header */}
      <section className={s.datasetHero}>
        <div className={s.datasetHeroInner}>
          <h2 className={s.datasetTitle}>{t("heroTitle")}</h2>
          <p className={s.datasetSubtitle}>{t("heroSubtitle")}</p>
          <div className={s.tagList}>
            {TAGS.map((tag) => (
              <span key={tag} className={s.tag}>{tag}</span>
            ))}
          </div>
          <a
            href={ZIP_URL}
            download="rootlens-sample-v0.1.zip"
            className={s.ctaPrimary}
          >
            {t("ctaDownloadAll")}
          </a>
        </div>
      </section>

      {/* Stats grid */}
      <section className={s.sectionFlush}>
        <div className={s.sectionInner}>
          <div className={s.statsGrid}>
            {stats.map(([label, value]) => (
              <div key={label} className={s.statCell}>
                <div className={s.statLabel}>{label}</div>
                <div className={s.statValue}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Per-frame contents */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h3 className={s.sectionTitle}>{t("s1Title")}</h3>
          <p className={s.prose}>{t("s1p1Lead")}</p>
          <ul className={s.bulletList}>
            {(t.raw("s1p1Items") as string[]).map((item, i) => (
              <li key={i} className={s.bulletItem} dangerouslySetInnerHTML={{ __html: renderInlineCode(item) }} />
            ))}
          </ul>
        </div>
      </section>

      {/* Directory layout */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h3 className={s.sectionTitle}>{t("s2Title")}</h3>
          <p className={s.prose} dangerouslySetInnerHTML={{ __html: renderInlineCode(t("s2p1")) }} />
          <pre className={s.codeBlock}><code>{DIR_TREE}</code></pre>
        </div>
      </section>

      {/* Action labels */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h3 className={s.sectionTitle}>{t("s3Title")}</h3>
          <p className={s.prose} dangerouslySetInnerHTML={{ __html: renderInlineCode(t("s3p1")) }} />
          <p className={s.prose}>{t("s3p2")}</p>
        </div>
      </section>

      {/* Loading */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h3 className={s.sectionTitle}>{t("loadingTitle")}</h3>
          <pre className={s.codeBlock}><code>{LOADING_CODE}</code></pre>
          <p className={s.proseSmall} dangerouslySetInnerHTML={{ __html: renderInlineCode(t("loadingNote")) }} />
        </div>
      </section>

      {/* Episodes */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h3 className={s.sectionTitle}>{t("episodesHeading")}</h3>
          <p className={s.prose}>{t("episodesSubheading")}</p>

          <EpisodeListClient total={doc.total_episodes} showAllLabel={t("showAll")}>
            {doc.episodes.map((ep) => (
              <article key={ep.index} className={s.episodeCard}>
                <SyncedVideoPair
                  videoSrc={videoUrl(ep.index)}
                  skeletonSrc={skeletonUrl(ep.index)}
                />
                <div className={s.episodeBody}>
                  <div className={s.episodeMeta}>
                    <span className={s.episodeId}>episode_{String(ep.index).padStart(3, "0")}</span>
                    <span className={s.episodeMetaDot}>&middot;</span>
                    <span>{ep.category}</span>
                    <span className={s.episodeMetaDot}>&middot;</span>
                    <span>{ep.duration_sec.toFixed(1)}s</span>
                    <span className={s.episodeMetaDot}>&middot;</span>
                    <span>{ep.length_frames} {t("episodesFrameLabel")}</span>
                  </div>
                  <p className={s.episodeTask}>{ep.task}</p>
                  <details className={s.episodePhases}>
                    <summary className={s.episodePhasesSummary}>
                      {t("episodesPhasesLabel")} ({ep.phases.length})
                    </summary>
                    <ol className={s.episodePhasesList}>
                      {ep.phases.map((p, i) => (
                        <li key={i} className={s.episodePhasesItem}>
                          <span className={s.episodePhasesTime}>
                            {fmtTimestamp(p.start_sec)}&ndash;{fmtTimestamp(p.end_sec)}
                          </span>
                          <span className={s.episodePhasesText}>{p.text}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                  <a
                    href={videoUrl(ep.index)}
                    download={`episode_${String(ep.index).padStart(3, "0")}.mp4`}
                    className={s.episodeDownload}
                  >
                    {t("episodeDownloadLabel")}
                  </a>
                </div>
              </article>
            ))}
          </EpisodeListClient>
        </div>
      </section>

      {/* Planned next release */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h3 className={s.sectionTitle}>{t("s4Title")}</h3>
          <p className={s.prose}>{t("s4p1Lead")}</p>
          <ul className={s.bulletList}>
            {(t.raw("s4p1Items") as string[]).map((item, i) => (
              <li key={i} className={s.bulletItem} dangerouslySetInnerHTML={{ __html: renderInlineCode(item) }} />
            ))}
          </ul>
        </div>
      </section>

      {/* License */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h3 className={s.sectionTitle}>{t("licenseHeading")}</h3>
          <p className={s.prose}>{t("licenseP1")}</p>
        </div>
      </section>
    </div>
  );
}

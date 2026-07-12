import ARKit
import Foundation

// Exports ARKit's scene reconstruction mesh at the end of a recording.

enum MeshExporter {

  /// Export ARMeshAnchors as JSONL, one anchor per row: vertices as float32 LE
  /// xyz × n and faces as uint32 LE vertex indices × 3 × m, base64-encoded.
  /// transform is a row-major 4×4 into world space, the same convention as
  /// camera_transform in realtime_handpose.jsonl. Values are copied verbatim
  /// from ARKit's buffers; no processing is applied.
  static func writeMeshJsonl(anchors: [ARMeshAnchor], into dir: URL) {
    guard !anchors.isEmpty else {
      NSLog("[MeshExporter] no mesh anchors to export")
      return
    }
    let url = dir.appendingPathComponent("mesh.jsonl")
    FileManager.default.createFile(atPath: url.path, contents: nil)
    guard let handle = try? FileHandle(forWritingTo: url) else { return }
    defer { try? handle.close() }

    for anchorObj in anchors {
      let g = anchorObj.geometry

      let vCount = g.vertices.count
      var verts = [Float]()
      verts.reserveCapacity(vCount * 3)
      let vBase = g.vertices.buffer.contents().advanced(by: g.vertices.offset)
      for i in 0..<vCount {
        let pv = vBase.advanced(by: i * g.vertices.stride).assumingMemoryBound(to: Float.self)
        verts.append(pv[0]); verts.append(pv[1]); verts.append(pv[2])
      }

      let fCount = g.faces.count
      let idxPer = g.faces.indexCountPerPrimitive
      var faces = [UInt32]()
      faces.reserveCapacity(fCount * idxPer)
      let fBase = g.faces.buffer.contents()
      let bytesPerIndex = g.faces.bytesPerIndex
      for i in 0..<(fCount * idxPer) {
        let off = i * bytesPerIndex
        if bytesPerIndex == 4 {
          faces.append(fBase.advanced(by: off).assumingMemoryBound(to: UInt32.self).pointee)
        } else {
          faces.append(UInt32(fBase.advanced(by: off).assumingMemoryBound(to: UInt16.self).pointee))
        }
      }

      let t = anchorObj.transform
      let rows: [[Float]] = [
        [t.columns.0[0], t.columns.1[0], t.columns.2[0], t.columns.3[0]],
        [t.columns.0[1], t.columns.1[1], t.columns.2[1], t.columns.3[1]],
        [t.columns.0[2], t.columns.1[2], t.columns.2[2], t.columns.3[2]],
        [t.columns.0[3], t.columns.1[3], t.columns.2[3], t.columns.3[3]],
      ]
      let vData = verts.withUnsafeBufferPointer { Data(buffer: $0) }
      let fData = faces.withUnsafeBufferPointer { Data(buffer: $0) }
      let line: [String: Any] = [
        "identifier": anchorObj.identifier.uuidString,
        "transform": rows,
        "vertex_count": vCount,
        "face_count": fCount,
        "vertices_b64": vData.base64EncodedString(),
        "faces_b64": fData.base64EncodedString(),
      ]
      if let data = try? JSONSerialization.data(withJSONObject: line, options: []) {
        try? handle.write(contentsOf: data)
        try? handle.write(contentsOf: Data("\n".utf8))
      }
    }
    NSLog("[MeshExporter] mesh.jsonl written: %d anchors", anchors.count)
  }
}

export {
  extrudeTextGeometry, clearText3dMeshCache,
  type MeshData, type Text3dStyle, type ExtrudeOptions,
} from "./mesh.js";
export {
  createTextStyle3d, shadeColor,
  type Text3DMaterial,
} from "./material.js";
export {
  renderTextMesh, projectMeshBounds,
  type Text3dRenderOptions,
} from "./render.js";
export {
  extrudeVectorText,
  chamferProfileOffset,
  type TextExtrusionOptions,
  type ChamferProfile,
} from "./extruder.js";

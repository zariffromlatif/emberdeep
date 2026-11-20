/**
 * The only door to Babylon.js. Everything is imported per module (not from the
 * "@babylonjs/core" root, which drags in the whole engine), so the bundle carries
 * only what the game uses. Need a new Babylon class? Add it here.
 */

// Runtime features that register themselves on import.
import "@babylonjs/core/Culling/ray"; // scene.pick / createPickingRay (tap targets)
import "@babylonjs/core/Rendering/outlineRenderer"; // mesh.renderOverlay (hit flashes)
import "@babylonjs/core/Particles/particleSystemComponent"; // particle effects
import "@babylonjs/core/Layers/effectLayerSceneComponent"; // glow layer
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent"; // bloom/tonemap pipeline
import "@babylonjs/core/Animations/animatable"; // KayKit animation playback
import "@babylonjs/loaders/glTF/2.0/glTFLoader"; // .glb/.gltf (KayKit models use no glTF extensions)
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";

import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";

// We draw our own loading veil; never show Babylon's.
SceneLoaderFlags.ShowLoadingScreen = false;

/** Just the shape builders we use (the full MeshBuilder pulls in every builder). */
export const MeshBuilder = { CreateBox, CreateCylinder, CreateDisc, CreateGround, CreatePlane, CreatePolyhedron, CreateSphere, CreateTorus };

export { Engine } from "@babylonjs/core/Engines/engine";
export { Scene } from "@babylonjs/core/scene";
export { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
export { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
export { PointLight } from "@babylonjs/core/Lights/pointLight";
export { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
export { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
export { Plane } from "@babylonjs/core/Maths/math.plane";
export { Material } from "@babylonjs/core/Materials/material";
export { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
export { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
export { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
export { Texture } from "@babylonjs/core/Materials/Textures/texture";
export { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
export { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
export { Mesh } from "@babylonjs/core/Meshes/mesh";
export { TransformNode } from "@babylonjs/core/Meshes/transformNode";
export { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
export { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
export { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
export { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
export { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
export { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
export { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
export { AssetContainer } from "@babylonjs/core/assetContainer";
export { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";

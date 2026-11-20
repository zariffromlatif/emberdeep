import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, type Material, type Scene, type Texture } from "@babylonjs/core";

export interface MatOpts {
  emissive?: string;
  emissiveScale?: number;
  spec?: number;
  specPower?: number;
  alpha?: number;
  texture?: Texture;
  noFog?: boolean;
  backFaces?: boolean;
}

/** Shared materials and primitive helpers for the code-built models. */
export class Kit {
  private mats = new Map<string, StandardMaterial>();

  constructor(readonly scene: Scene, readonly maxLights: number) {}

  mat(hex: string, o: MatOpts = {}): StandardMaterial {
    const key = `${hex}|${o.emissive ?? ""}|${o.emissiveScale ?? 1}|${o.spec ?? 0.08}|${o.alpha ?? 1}|${o.texture?.name ?? ""}|${o.backFaces ? 1 : 0}`;
    let m = this.mats.get(key);
    if (m) return m;
    m = new StandardMaterial(`m${this.mats.size}`, this.scene);
    m.diffuseColor = Color3.FromHexString(hex);
    const s = o.spec ?? 0.08;
    m.specularColor = new Color3(s, s, s);
    m.specularPower = o.specPower ?? 24;
    if (o.emissive) m.emissiveColor = Color3.FromHexString(o.emissive).scale(o.emissiveScale ?? 1);
    if (o.alpha !== undefined && o.alpha < 1) m.alpha = o.alpha;
    if (o.texture) m.diffuseTexture = o.texture;
    if (o.noFog) m.fogEnabled = false;
    if (o.backFaces) m.backFaceCulling = false;
    m.maxSimultaneousLights = this.maxLights;
    this.mats.set(key, m);
    return m;
  }

  /** A glowing, unlit material (flames, eyes, magic). */
  glow(hex: string, scale = 1.6): StandardMaterial {
    const key = `glow|${hex}|${scale}`;
    let m = this.mats.get(key);
    if (m) return m;
    m = new StandardMaterial(key, this.scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(hex).scale(scale);
    m.fogEnabled = false;
    this.mats.set(key, m);
    return m;
  }

  private place(mesh: Mesh, mat: Material, parent: TransformNode | null, x: number, y: number, z: number): Mesh {
    mesh.material = mat;
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    return mesh;
  }

  box(w: number, h: number, d: number, mat: Material, parent: TransformNode | null, x = 0, y = 0, z = 0): Mesh {
    return this.place(MeshBuilder.CreateBox("b", { width: w, height: h, depth: d }, this.scene), mat, parent, x, y, z);
  }

  cyl(dTop: number, dBottom: number, h: number, tess: number, mat: Material, parent: TransformNode | null, x = 0, y = 0, z = 0): Mesh {
    const m = MeshBuilder.CreateCylinder("c", { diameterTop: dTop, diameterBottom: dBottom, height: h, tessellation: tess }, this.scene);
    m.convertToFlatShadedMesh();
    return this.place(m, mat, parent, x, y, z);
  }

  ball(d: number, seg: number, mat: Material, parent: TransformNode | null, x = 0, y = 0, z = 0, flat = true): Mesh {
    const m = MeshBuilder.CreateSphere("s", { diameter: d, segments: seg }, this.scene);
    if (flat) m.convertToFlatShadedMesh();
    return this.place(m, mat, parent, x, y, z);
  }

  rock(size: number, type: number, mat: Material, parent: TransformNode | null, x = 0, y = 0, z = 0): Mesh {
    const m = MeshBuilder.CreatePolyhedron("p", { type, size }, this.scene);
    m.convertToFlatShadedMesh();
    return this.place(m, mat, parent, x, y, z);
  }

  torus(d: number, thick: number, tess: number, mat: Material, parent: TransformNode | null, x = 0, y = 0, z = 0): Mesh {
    const m = MeshBuilder.CreateTorus("t", { diameter: d, thickness: thick, tessellation: tess }, this.scene);
    return this.place(m, mat, parent, x, y, z);
  }

  plane(w: number, h: number, mat: Material, parent: TransformNode | null, x = 0, y = 0, z = 0): Mesh {
    const m = MeshBuilder.CreatePlane("pl", { width: w, height: h, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    return this.place(m, mat, parent, x, y, z);
  }

  node(name: string, parent: TransformNode | null, x = 0, y = 0, z = 0): TransformNode {
    const n = new TransformNode(name, this.scene);
    n.parent = parent;
    n.position.set(x, y, z);
    return n;
  }
}

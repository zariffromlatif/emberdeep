"""Trim KayKit .glb characters down to the animations Emberdeep plays.

The KayKit packs (CC0, Kay Lousberg) ship 76-95 animations per character; most of
each file is animation data we never use. This keeps the listed clips, drops the
accessors/bufferViews nothing references any more, and repacks the binary chunk.

Usage:  python -I tools/trim_glb.py public/models/kaykit/*.glb
(Files are rewritten in place. Re-download the originals from
 github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 and
 github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 to start over.)
"""
import json
import struct
import sys

KEEP = {
    "Idle", "Idle_Combat", "Walking_A", "Walking_D_Skeletons",
    "1H_Melee_Attack_Chop", "1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Stab",
    "2H_Melee_Attack_Chop", "2H_Melee_Attack_Slice", "Dualwield_Melee_Attack_Stab",
    "Unarmed_Melee_Attack_Punch_A", "1H_Ranged_Shoot", "Throw",
    "Spellcast_Shoot", "Spellcast_Long", "Spellcast_Raise", "Spellcast_Summon",
    "Hit_A", "Hit_B", "Block_Hit", "Dodge_Backward",
    "Death_A", "Death_A_Pose", "Death_C_Skeletons", "Death_C_Pose",
    "Cheer", "Use_Item", "Interact",
    "Skeleton_Inactive_Standing_Pose", "Skeletons_Awaken_Standing", "Spawn_Ground_Skeletons",
}


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2, "not a glTF 2 binary"
    off = 12
    js, binc = None, b""
    while off < len(data):
        length, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + length]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + length
    return js, binc


def write_glb(path, js, binc):
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * ((4 - len(jb) % 4) % 4)
    binc += b"\0" * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack("<II", len(binc), 0x004E4942) + binc)


def trim(path):
    js, binc = read_glb(path)
    before = len(binc)
    js["animations"] = [a for a in js.get("animations", []) if a["name"] in KEEP]

    # Which accessors are still referenced?
    used_acc = set()
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            used_acc.update(p["attributes"].values())
            if "indices" in p:
                used_acc.add(p["indices"])
            for t in p.get("targets", []):
                used_acc.update(t.values())
    for s in js.get("skins", []):
        if "inverseBindMatrices" in s:
            used_acc.add(s["inverseBindMatrices"])
    for a in js["animations"]:
        for smp in a["samplers"]:
            used_acc.add(smp["input"])
            used_acc.add(smp["output"])
    acc_map = {}
    new_acc = []
    for i, a in enumerate(js.get("accessors", [])):
        if i in used_acc:
            acc_map[i] = len(new_acc)
            new_acc.append(a)

    used_bv = {a["bufferView"] for a in new_acc if "bufferView" in a}
    used_bv |= {img["bufferView"] for img in js.get("images", []) if "bufferView" in img}
    bv_map = {}
    new_bv = []
    out = bytearray()
    for i, bv in enumerate(js.get("bufferViews", [])):
        if i not in used_bv:
            continue
        start = bv.get("byteOffset", 0)
        chunk = binc[start: start + bv["byteLength"]]
        out += b"\0" * ((4 - len(out) % 4) % 4)
        nbv = dict(bv)
        nbv["byteOffset"] = len(out)
        out += chunk
        bv_map[i] = len(new_bv)
        new_bv.append(nbv)

    for a in new_acc:
        if "bufferView" in a:
            a["bufferView"] = bv_map[a["bufferView"]]
    for img in js.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = bv_map[img["bufferView"]]
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
            if "targets" in p:
                p["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in p["targets"]]
    for s in js.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
    for a in js["animations"]:
        for smp in a["samplers"]:
            smp["input"] = acc_map[smp["input"]]
            smp["output"] = acc_map[smp["output"]]

    js["accessors"] = new_acc
    js["bufferViews"] = new_bv
    js["buffers"] = [{"byteLength": len(out)}]
    write_glb(path, js, bytes(out))
    print(f"{path}: {len(js['animations'])} animations, {before // 1024} KB -> {len(out) // 1024} KB")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        trim(p)

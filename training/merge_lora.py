"""Merge the Kaggle LoRA (lora.zip -> lora/) into the full Qwen3-VL-8B-Instruct weights, shard by shard.

W += (lora_alpha / r) * B @ A for every adapted layer, done in float32 and stored back in the base dtype.
Everything else in the base folder (config, tokenizer, processor, shard index) is copied unchanged, so the
result loads like the base model and llama.cpp's convert_hf_to_gguf.py converts it the same way.

    python training/merge_lora.py base/Qwen3-VL-8B-Instruct lora_adapter/lora merged
"""
import json, shutil, sys
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file


def main(base, adapter, out):
    base, adapter, out = Path(base), Path(adapter), Path(out)
    cfg = json.loads((adapter / "adapter_config.json").read_text())
    assert not cfg.get("use_rslora") and not cfg.get("use_dora"), "only plain LoRA is handled"
    scale = cfg["lora_alpha"] / cfg["r"]

    pairs = {}   # base weight name -> [A, B]
    with safe_open(adapter / "adapter_model.safetensors", "pt") as f:
        for k in f.keys():
            name, part = k.removeprefix("base_model.model.").rsplit(".lora_", 1)
            pairs.setdefault(name + ".weight", [None, None])["AB".index(part[0])] = f.get_tensor(k)

    out.mkdir(parents=True, exist_ok=True)
    for p in base.iterdir():
        if p.is_file() and p.suffix != ".safetensors":
            shutil.copy2(p, out / p.name)

    done = set()
    for shard in sorted(base.glob("*.safetensors")):
        tensors = {}
        with safe_open(shard, "pt") as f:
            meta = f.metadata()
            for k in f.keys():
                w = f.get_tensor(k)
                if k in pairs:
                    a, b = pairs[k]
                    w = (w.float() + scale * (b.float() @ a.float())).to(w.dtype)
                    done.add(k)
                tensors[k] = w
        save_file(tensors, out / shard.name, metadata=meta)
        print(shard.name, "merged", sum(k in pairs for k in tensors), "layers", flush=True)

    missing = set(pairs) - done
    if missing:
        sys.exit(f"{len(missing)} adapter layers have no base weight, e.g. {sorted(missing)[:3]}")
    print(f"all {len(done)} adapted layers merged (scale {scale}) into {out}")


if __name__ == "__main__":
    main(*sys.argv[1:4])

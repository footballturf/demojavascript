---
name: ito-serve
description: Provision and inspect a self-hosted open-weights inference deployment on Itô-rented GPUs. Reserve a fixed-rate GPU block through the canonical Itô CLI, place an open-weights checkpoint onto it, and bring up a served inference endpoint across the reserved nodes. Use when a user asks to self-host Kimi (or any open-weights model) on rented Itô compute and serve it behind an endpoint.
---

# ito-serve

The provisioning half of Itô-as-inference-provider. Where `ito-compute`
finds capacity and prices a fixed-rate RFQ, `ito-serve` takes a reserved
block and stands a model up on it: place the checkpoint, launch the serving
engine across the nodes, expose an OpenAI-compatible endpoint.

ECC does not run the inference server itself. It orchestrates: it drives the
canonical Itô CLI for reservation, and the model's own recommended serving
engine (SGLang or vLLM) for the deployment. The value is the glue, one
harness command from "I want to serve K3" to a live endpoint on compute you
rented by the hour.

## Positioning (say it exactly this way)

Itô rents you the GPUs at a fixed rate and provisions the open-weights model
onto them for you. That is the product: a fixed-rate inference provider where
the underlying compute is yours for the term, not a black-box API. You get
API-shaped access and the machine underneath.

## What this skill does NOT claim

- It does not train. This is inference deployment only.
- It does not reserve capacity as a side effect of inspection. Reservation
  is an explicit, authenticated RFQ through the canonical Itô CLI.
- It does not assert an endpoint is live until the served engine returns a
  healthy status. Report bring-up state honestly, including failures.

## Flow

1. `ecc ito find` — locate H100/H200 capacity, get a fixed-rate quote.
2. Reserve the block (authenticated RFQ, explicit human go).
3. Place the checkpoint on the reserved nodes' scratch storage.
4. Launch the model's recommended engine across the nodes (multi-node for
   checkpoints that exceed one node's HBM, e.g. K3 at 1.56TB spans two
   8xH200 nodes over the reserved fabric).
5. Health-check the endpoint; report the served model, node count, and the
   fixed rate the block is held at.

## Node inspection helper

`scripts/serve-status.sh` streams the real deployment state from the reserved
nodes: GPU/HBM occupancy across the fleet, fabric link state, and the served
model's health. It reads live; it invents nothing.

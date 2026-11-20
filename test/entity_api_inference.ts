import { asSlotIndex, type Entity, entityIndex, type World } from "../mod.ts";
import type { EntityManager } from "../src/entity/entity-manager.ts";

declare const world: World;
declare const entity: Entity;
declare const manager: EntityManager;

world.entities.getActive(entityIndex(entity), asSlotIndex(world.entities.capacity));
world.entities.getActiveSnapshot(asSlotIndex(0), asSlotIndex(world.entities.capacity));
manager.getActive(entityIndex(entity), asSlotIndex(manager.capacity));

// @ts-expect-error Packed entity handles are not raw slot bounds.
world.entities.getActive(entity);
// @ts-expect-error Snapshot bounds also require slots, even for the upper bound.
world.entities.getActiveSnapshot(undefined, entity);
// @ts-expect-error The underlying manager uses the same slot contract.
manager.getActive(entity);

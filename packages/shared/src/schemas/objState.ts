import { Schema, type } from "@colyseus/schema";

/**
 * Shared object state schema synced to clients.
 * Represents static objects in the world (crates, pillars, etc.).
 */
export class ObjState extends Schema {
  /** Unique object identifier. */
  @type("string") id = "";

  /** Template identifier. */
  @type("string") templateId = "";

  /** World X position. */
  @type("float32") x = 0;

  /** World Y position (height). */
  @type("float32") y = 0;

  /** World Z position. */
  @type("float32") z = 0;

  /** Shape of the object (box, sphere, cylinder). */
  @type("string") shape = "box";

  /** Size of the object. */
  @type("float32") size = 1;

  /** Whether this object blocks movement. */
  @type("boolean") collidable = true;

  /** Whether this object can be picked up. */
  @type("boolean") pickable = false;

  /** Optional display label. */
  @type("string") label = "";

  /** RGB color - red component (0-1). */
  @type("float32") colorR = 1;

  /** RGB color - green component (0-1). */
  @type("float32") colorG = 1;

  /** RGB color - blue component (0-1). */
  @type("float32") colorB = 1;
}

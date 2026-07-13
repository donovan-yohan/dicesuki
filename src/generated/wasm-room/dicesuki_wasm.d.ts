/* tslint:disable */
/* eslint-disable */

/**
 * A solo in-browser room: `dicesuki-core` compiled to wasm, driven by the
 * Web Worker host shim. One instance per worker.
 */
export class WasmRoom {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Decode and apply one inbound client protocol message. Returns the
     * resulting outbound messages (JSON strings); also invokes `on_message`.
     */
    handleMessage(json: string): Array<any>;
    /**
     * Whether the room currently wants ticks. The worker can pause its timer
     * while this is `false` to avoid burning a frame budget on an idle room.
     */
    isSimulating(): boolean;
    /**
     * Construct an empty solo room.
     *
     * `room_id` labels the room in `room_state`. `on_message` (optional) is
     * called with each outbound protocol JSON string as it is produced; it
     * is the worker's `postMessage` pump. Every mutating method also returns
     * the same messages as an array, so a purely polling host works too.
     */
    constructor(room_id: string, on_message?: Function | null);
    /**
     * Advance the simulation one fixed 60Hz step. `dt_ms` is accepted for
     * symmetry with a wall-clock driver but ignored (core uses a fixed
     * timestep). Returns the outbound messages; also invokes `on_message`.
     */
    tick(dt_ms: number): Array<any>;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmroom_free: (a: number, b: number) => void;
    readonly wasmroom_handleMessage: (a: number, b: number, c: number) => number;
    readonly wasmroom_isSimulating: (a: number) => number;
    readonly wasmroom_new: (a: number, b: number, c: number) => number;
    readonly wasmroom_tick: (a: number, b: number) => number;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

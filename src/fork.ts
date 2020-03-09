const Me = imports.misc.extensionUtils.getCurrentExtension();

import type { AutoTiler } from 'auto_tiler';
import type { Entity } from 'ecs';
import type { Ext } from 'extension';
import type { Rectangle } from 'rectangle';
import type { Node } from 'node';

import * as Lib from 'lib';
import * as Log from 'log';
import * as Rect from 'rectangle';

const { orientation_as_str } = Lib;
const MINIMUM_LENGTH = 256;

const XPOS = 0;
const YPOS = 1;
const WIDTH = 2;
const HEIGHT = 3;

/// A tiling fork contains two children nodes. These nodes may either be windows, or sub-forks.
export class Fork {
    left: Node;
    right: Node | null;
    area: Rectangle;
    left_length: number = 0;
    prev_left: number = 0;
    parent: Entity | null = null;
    workspace: number;
    orientation: Lib.Orientation = Lib.Orientation.HORIZONTAL;
    is_toplevel: boolean = false;

    constructor(left: Node, right: Node | null, area: Rectangle, workspace: number) {
        this.area = area;
        this.left = left;
        this.right = right;
        this.workspace = workspace;
    }

    area_of(ext: Ext, child: Entity): Rect.Rectangle | null {
        if (this.left.is_window(child)) {
            return this.area_of_left(ext);
        } else if (this.right?.is_window(child)) {
            return this.area_of_right(ext);
        } else {
            return null;
        }
    }

    area_of_left(ext: Ext): Rect.Rectangle {
        let area = this.area.clone();

        if (this.is_horizontal()) {
            area.width = this.left_length;
        } else {
            area.height = this.left_length;
        }

        return area;
    }

    area_of_right(ext: Ext): Rect.Rectangle | null {
        if (this.right) {
            let area: [number, number, number, number];

            const length = this.left_length + ext.gap_inner;

            if (this.is_horizontal()) {
                area = [length, this.area.y, this.area.width - length, this.area.height];
            } else {
                area = [this.area.x, length, this.area.width, this.area.height - length];
            }

            return new Rect.Rectangle(area);
        }

        return null;
    }

    display(fmt: string) {
        fmt += `{\n  parent: ${this.parent},`;
        fmt += `\n  area: (${this.area.array}),`;

        fmt += `\n  workspace: (${this.workspace}),`;

        if (this.left) {
            fmt += `\n  left: ${this.left.display('')},`;
        }

        if (this.right) {
            fmt += `\n  right: ${this.right.display('')},`;
        }

        fmt += `\n  orientation: ${orientation_as_str(this.orientation)}\n}`;
        return fmt;
    }

    is_horizontal(): boolean {
        return Lib.Orientation.HORIZONTAL == this.orientation;
    }

    ratio(): number {
        return this.is_horizontal() ? this.left_length / this.area.width : this.left_length / this.area.height;
    }

    /// Replaces the association of a window in a fork with another
    replace_window(a: Entity, b: Entity): boolean {
        if (this.left.is_window(a)) {
            this.left.entity = b;
        } else if (this.right) {
            this.right.entity = b;
        } else {
            return false;
        }

        return true;
    }

    set_area(area: Rectangle): Rectangle {
        Log.info(`PREV LEFT LENGTH: ${this.left_length}`);
        const ratio = this.ratio();
        this.area = area;
        this.left_length = Math.round(this.is_horizontal() ? this.area.width * ratio : this.area.height * ratio);
        Log.info(`NEW LEFT LENGTH: ${this.left_length}`);
        return this.area;
    }

    set_orientation(orientation: number): Fork {
        this.orientation = orientation;
        return this;
    }

    set_parent(parent: Entity): Fork {
        this.parent = parent;
        return this;
    }

    set_ratio(left_length: number): Fork {
        this.prev_left = this.left_length;
        const total = this.is_horizontal() ? this.area.width : this.area.height;
        this.left_length = Math.min(Math.max(MINIMUM_LENGTH, left_length), total - MINIMUM_LENGTH);

        return this;
    }

    set_toplevel(ext: Ext, tiler: AutoTiler, entity: Entity, string: string, id: [number, number]): Fork {
        this.is_toplevel = true;
        tiler.toplevel.set(string, [entity, id]);

        this.area.x += ext.gap_outer;
        this.area.y += ext.gap_outer;
        this.area.width -= ext.gap_outer * 2;
        this.area.height -= ext.gap_outer * 2;

        return this;
    }

    /// Tiles all windows within this fork into the given area
    tile(tiler: AutoTiler, ext: Ext, area: Rectangle, workspace: number, failure_allowed: boolean): boolean {
        if (!this.is_toplevel) {
            this.area = this.set_area(area.clone());
        }

        if (this.left_length === 0) {
            this.left_length = this.is_horizontal()
                ? this.area.width / 2
                : this.area.height / 2;
            this.prev_left = this.left_length;
        }

        this.workspace = workspace;

        if (this.right) {
            const [l, p] = this.is_horizontal() ? [WIDTH, XPOS] : [HEIGHT, YPOS];

            let region = this.area.clone();
            region.array[l] = this.left_length - ext.gap_inner_half;

            if (this.left.tile(tiler, ext, region, workspace) || failure_allowed) {
                region.array[p] = region.array[p] + this.left_length + ext.gap_inner;
                region.array[l] = this.area.array[l] - this.left_length - ext.gap_inner;

                if (this.right.tile(tiler, ext, region, workspace) || failure_allowed) {
                    return true;
                } else {
                    Log.debug(`failed to move right node`);

                    this.left_length = this.prev_left;

                    this.left.tile(tiler, ext, this.area_of_left(ext), workspace);
                    this.right.tile(tiler, ext, this.area_of_right(ext) as Rectangle, workspace);
                }
            } else {
                Log.debug(`failed to move left node`);
                this.left_length = this.prev_left;
                this.left.tile(tiler, ext, this.area_of_left(ext), workspace);
            }
        } else if (this.left.tile(tiler, ext, this.area, workspace) || failure_allowed) {
            return true;
        }

        return false;
    }

    toggle_orientation() {
        this.orientation = Lib.Orientation.HORIZONTAL == this.orientation
            ? Lib.Orientation.VERTICAL
            : Lib.Orientation.HORIZONTAL;

        this.left_length = Math.round(
            this.is_horizontal()
                ? (this.left_length / this.area.height) * this.area.width
                : (this.left_length / this.area.width) * this.area.height
        );
    }
}

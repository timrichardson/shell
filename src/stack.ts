// @ts-ignore
const Me = imports.misc.extensionUtils.getCurrentExtension();

import type { Entity } from './ecs';
import type { Ext } from './extension';
import type { ShellWindow } from './window';

import * as Ecs from 'ecs';
import * as a from 'arena';

const Arena = a.Arena;
const { St } = imports.gi;

const ACTIVE_TAB = 'pop-shell-tab pop-shell-tab-active';
const INACTIVE_TAB = 'pop-shell-tab pop-shell-tab-inactive';
const URGENT_TAB = 'pop-shell-tab pop-shell-tab-urgent';

interface Component {
    entity: Entity;
    button: number;
    meta: Meta.Window;
    signals: Array<SignalID>;
}

interface StackWidgets {
    tabs: St.Widget;
}

function stack_widgets_new(): StackWidgets {
    let tabs = new St.BoxLayout({
        style_class: 'pop-shell-stack',
        x_expand: true
    });

    tabs.get_layout_manager()?.set_homogeneous(true);

    return { tabs };
}

export class Stack {
    ext: Ext;

    widgets: null | StackWidgets = null;

    active: Entity;

    active_id: number = 0

    components: Array<Component> = new Array();

    workspace: number;

    buttons: a.Arena<St.Button> = new Arena();

    private rect: Rectangular = { width: 0, height: 0, x: 0, y: 0 };

    private restacker: SignalID = (global.display as GObject.Object).connect('restacked', () => this.restack());

    constructor(ext: Ext, active: Entity, workspace: number) {
        this.ext = ext;
        this.active = active;
        this.workspace = workspace;

        this.widgets = stack_widgets_new();

        global.window_group.add_child(this.widgets.tabs);

        this.reposition();

        this.widgets.tabs.connect('destroy', () => this.recreate_widgets());
    }

    /** Activates a tab based on the previously active entry */
    auto_activate(): null | Entity {
        if (this.components.length === 0) return null;

        let id = this.components.length <= this.active_id ? this.components.length - 1 : this.active_id;

        const c = this.components[id];

        this.activate(c.entity);
        return c.entity;
    }

    /** Workaround for when GNOME Shell destroys our widgets when they're reparented
     *  in an active workspace change. */
    recreate_widgets() {
        if (this.widgets !== null) {
            this.widgets = stack_widgets_new();

            global.window_group.add_child(this.widgets.tabs);

            this.widgets.tabs.connect('destroy', () => this.recreate_widgets());

            for (const c of this.components.splice(0)) {
                for (const s of c.signals) c.meta.disconnect(s);
                const window = this.ext.windows.get(c.entity);
                if (window) this.add(window);
            }

            this.update_positions(this.rect);
            this.restack();
        }
    }

    /** Activates the tab of this entity */
    activate(entity: Entity) {
        this.active = entity;
        let id = 0;

        for (const component of this.components) {
            let name;

            const actor = component.meta.get_compositor_private();

            if (Ecs.entity_eq(entity, component.entity)) {
                this.active_id = id;
                name = ACTIVE_TAB;
                if (actor) actor.show()
            } else {
                name = INACTIVE_TAB;
                if (actor) actor.hide();
            }

            this.buttons.get(component.button)?.set_style_class_name(name);

            id += 1;
        }

        this.restack();
    }

    /** Clears watched components and removes all tabs */
    clear() {
        this.buttons.truncate(0);
        this.widgets?.tabs.destroy_all_children();

        for (const c of this.components.splice(0)) {
            for (const s of c.signals) c.meta.disconnect(s);
        }
    }

    /** Disconnects this stack's signal, and destroys its widgets */
    destroy() {
        global.display.disconnect(this.restacker);

        // Disconnect stack signals from each window, and unhide them.
        for (const c of this.components) {
            for (const s of c.signals) c.meta.disconnect(s);
            c.meta.get_compositor_private()?.show();
        }

        for (const b of this.buttons.values()) b.destroy();

        if (this.widgets) {
            const tabs = this.widgets.tabs;
            this.widgets = null;
            tabs.destroy();
        }
    }

    /** Removes the tab associated with the entity */
    remove_tab(entity: Entity) {
        if (!this.widgets) return;

        let idx = 0;
        for (const c of this.components) {
            if (Ecs.entity_eq(c.entity, entity)) {
                const b = this.buttons.remove(c.button);
                if (b) this.widgets.tabs.remove_child(b);
                for (const s of c.signals) c.meta.disconnect(s);
                this.components.splice(idx, 1);
                break
            }
        }
    }

    /** Repositions the stack, and hides all but the active window in the stack */
    restack() {
        if (this.widgets?.tabs.visible) {
            for (const c of this.components) {
                c.meta.get_compositor_private()?.hide();
            }

            this.reposition();
        }
    }

    /** Repositions the stack, arranging the stack's actors around the active window */
    reposition() {
        if (!this.widgets) return;

        const window = this.ext.windows.get(this.active);
        if (!window) return;

        const actor = window.meta.get_compositor_private();
        if (!actor) return;

        actor.show();

        const parent = actor.get_parent();

        if (!parent) {
            return;
        }

        let restack = false;
        const stack_parent = this.widgets.tabs.get_parent();
        if (!stack_parent) {
            parent.add_child(this.widgets.tabs);
            restack = true;
        } else if (stack_parent != parent) {
            stack_parent.remove_child(this.widgets.tabs);
            restack = true;
        }

        if (restack) {
            parent.add_child(this.widgets.tabs);
            for (const c of this.components) {
                if (Ecs.entity_eq(c.entity, this.active)) continue;
                const actor = c.meta.get_compositor_private();
                if (!actor) continue
                actor.hide();
            }
        }

        if (!window.meta.is_fullscreen() && !window.is_maximized()) {
            parent.set_child_above_sibling(this.widgets.tabs, actor);
        } else {
            parent.set_child_below_sibling(this.widgets.tabs, actor);
        }
    }

    /** Changes visibility of the stack's actors */
    set_visible(visible: boolean) {
        if (!this.widgets) return;

        if (visible) {
            this.widgets.tabs.show();
            this.widgets.tabs.visible = true;
        } else {
            this.widgets.tabs.visible = false;
            this.widgets.tabs.hide();
        }
    }

    /** Updates the dimensions and positions of the stack's actors */
    update_positions(rect: Rectangular) {
        if (!this.widgets) return;

        this.rect = rect;

        const width = 4 * this.ext.dpi;
        const tabs_height = width * 6;

        this.widgets.tabs.x = rect.x;
        this.widgets.tabs.y = rect.y - tabs_height;
        this.widgets.tabs.height = tabs_height;
        this.widgets.tabs.width = rect.width;
    }

    /** Adds a new window to the stack */
    add(window: ShellWindow) {
        if (!this.widgets) return;

        const entity = window.entity;
        const label = window.meta.get_title();

        const button: St.Button = new St.Button({
            label,
            x_expand: true,
            style_class: Ecs.entity_eq(entity, this.active) ? ACTIVE_TAB : INACTIVE_TAB
        });

        // On click, raise the window to the top of the stack, and activate the window's tab
        button.connect('clicked', () => {
            this.activate(entity);
            const window = this.ext.windows.get(entity);
            if (window) {
                const actor = window.meta.get_compositor_private();
                if (actor) {
                    actor.show();
                    window.meta.raise();
                    window.meta.unminimize();
                    window.meta.activate(global.get_current_time());

                    this.reposition();

                    for (const comp of this.components) {
                        this.buttons.get(comp.button)?.set_style_class_name(INACTIVE_TAB);
                    }

                    button.set_style_class_name(ACTIVE_TAB);
                } else {
                    this.remove_tab(entity);
                    window.stack = null;
                }
            }
        });

        const id = this.buttons.insert(button);

        // Watch for title changes and update the tab immediately.
        const signals = [
            window.meta.connect('notify::title', () => {
                this.buttons.get(id)?.set_label(window.meta.get_title());
            }),

            window.meta.connect('notify::urgent', () => {
                if (!window.meta.has_focus()) {
                    this.buttons.get(id)?.set_style_class_name(URGENT_TAB);
                }
            })
        ];

        this.components.push({ entity, signals, button: id, meta: window.meta });
        this.widgets.tabs.add(button);
    }
}

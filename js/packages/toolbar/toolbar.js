/*jslint nomen: true, browser:true, curly:false*/
/*global define */

define(['jquery', 'handlebars', 'text!./toolbar-button-template.html', 'text!./toolbar-template.html', 'css!./toolbar'], function ($, Handlebars, toolbarButtonTemplateStr, toolbarTemplateStr) {
    "use strict";

    var toolbarButtonTemplate = Handlebars.compile(toolbarButtonTemplateStr);
    var toolbarTemplate = Handlebars.compile(toolbarTemplateStr);

    var Toolbar = function (parent, callbacks, params) {
        this._parent = $(parent);
        this.callbacks = callbacks;
        this._buttonWidth = params.buttonWidth;
        this._spread = params.spread;

        // compile toolbar template
        this._toolbar = $(toolbarTemplate());
        this._buttonWrapper = this._toolbar.find(".toolbar-button-wrapper");
        this._buttons = {};

        this.logger = params.logger;

        this._parent.append(this._toolbar);

        var button, label, num = 0;
        for (label in this.callbacks) {
            // compile button template
            button = $(toolbarButtonTemplate({
                label: label,
                num: num
            }));
            button.appendTo(this._buttonWrapper);
            this._bindButtonHandlers(button, label);
            this._buttons[label] = {
                button: button,
                num: num,
                label: label
            };
            num++;
        }

        // button.css('border-bottom-right', this._buttonWrapper.css('border-bottom-right')); // safari border fix
        // button.css('border-bottom-left', this._buttonWrapper.css('border-bottom-left')); // safari border fix

        if (this._buttonWidth !== 'none' && typeof this._buttonWidth !== 'undefined') this._adjustButtonsWidth();
        if (this._spread) {
            var that = this;
            $(window).resize(function () {
                that._spreadButtons();
            });
            this._spreadButtons();
        }
    };


    Toolbar.prototype = {
        get parent() {
            return this._parent;
        },

        getButton: function (label) {
            return this._buttons[label].button;
        },

        getButtonPosition: function (label) {
            return this._buttons[label].num;
        },

        _getWiderButtonWidth: function () {
            var buttonName, button, maxWidth = -1;
            for (buttonName in this._buttons) {
                button = this._buttons[buttonName].button;
                maxWidth = Math.max(button.width(), maxWidth);
            }
            return maxWidth;
        },

        _adjustButtonsWidth: function () {
            var buttonName, button, buttonWidth = this._buttonWidth;
            if (this._buttonWidth == 'max') buttonWidth = this._getWiderButtonWidth();
            for (buttonName in this._buttons) {
                button = this._buttons[buttonName].button;
                button.width(buttonWidth);
            }
        },

        _spreadButtons: function () {
            var buttonCount = Object.keys(this._buttons).length,
                wrapperWidth = this._buttonWrapper.width(),
                buttons = this._buttonWrapper.find('.toolbar-button'),
                freeSpace, gap,
                totalWidth = 0,
                nextLeft = 0;

            buttons.each(function (number, button) {
                totalWidth += $(button).outerWidth();
            });

            freeSpace = wrapperWidth - totalWidth;
            gap = freeSpace / (buttonCount - 1);

            buttons.each(function (num, button) {
                button = $(button);
                button.css({
                    position: 'absolute',
                    left: nextLeft
                });
                nextLeft += button.outerWidth() + gap;
            });
        },

        _bindButtonHandlers: function (button, label) {
            var callback = this.callbacks[label],
                that = this;
            button.on({
                click: function (evt) {
                    if (that.logger) {
                        that.logger.set({
                            triggerPos: {
                                x: evt.pageX,
                                y: evt.pageY
                            }
                        });
                    }
                    callback(label, evt, button);
                },
                touchstart: function () {} // debug :active css pseudo class
            });
        },

        _bindFSMHandlers: function () {

            for (var prop in this) {
                if (prop.startsWith("_on")) {
                    var fsmStr = prop.toLowerCase().slice(1),
                        method = this[prop];
                    if (typeof method === "function") {
                        this._fsm[fsmStr] = $.proxy(this[prop], this);
                    }
                }
            }

        },

        show: function () {
            this._toolbar.show(0);
        },

        hide: function () {
            this._toolbar.hide(0);
        },

        remove: function () {
            this._toolbar.remove();
        }

    };

    return Toolbar;

});
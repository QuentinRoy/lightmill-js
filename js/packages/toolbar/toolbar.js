/*jslint nomen: true, browser:true, curly:false*/
/*global define */

define(['jquery', 'handlebars', 'text!./toolbar-button-template.html', 'text!./toolbar-template.html', 'css!./toolbar'], function ($, Handlebars, toolbarButtonTemplateStr, toolbarTemplateStr) {

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

        var button, label, first = true;
        for (label in this.callbacks) {
            if (first) {
                // button.css('border-top-right', this._buttonWrapper.css('border-top-right')); // safari border fix
                // button.css('border-top-left', this._buttonWrapper.css('border-top-left')); // safari border fix
                first = false;
            }
            // compile button template
            button = $(toolbarButtonTemplate({
                label: label
            }));
            button.appendTo(this._buttonWrapper);
            this._bindButtonHandlers(button, label);
            this._buttons[label] = button;
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
            return this._buttons[label];
        },

        _getWiderButtonWidth: function () {
            var buttonName, button, maxWidth = -1;
            for (buttonName in this._buttons) {
                button = this._buttons[buttonName];
                maxWidth = Math.max(button.width(), maxWidth);
            }
            return maxWidth;
        },

        _adjustButtonsWidth: function () {
            var buttonName, button, buttonWidth = this._buttonWidth;
            if (this._buttonWidth == 'max') buttonWidth = this._getWiderButtonWidth();
            for (buttonName in this._buttons) {
                button = this._buttons[buttonName];
                button.width(buttonWidth);
            }
        },

        _spreadButtons: function () {
            var label, button,
                buttonCount = Object.keys(this._buttons).length,
                wrapperWidth = this._buttonWrapper.width(),
                freeSpace, gap,
                totalWidth = 0,
                nextLeft = 0;

            $.each(this._buttons, function (number, button) {
                totalWidth += button.outerWidth();
            });

            freeSpace = wrapperWidth - totalWidth;
            gap = freeSpace / (buttonCount - 1);

            for (label in this._buttons) {
                button = this._buttons[label];
                button.css({
                    position: 'absolute',
                    left: nextLeft
                });
                nextLeft += button.outerWidth() + gap;
            }
        },

        _bindButtonHandlers: function (button, label) {
            var callback = this.callbacks[label],
                that = this;
            button.on({
                click: function (evt) {
                    callback();
                    if (that.logger) {
                        that.logger.set({
                            triggerPos: {
                                x: evt.pageX,
                                y: evt.pageY
                            }
                        });
                    }
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

    };

    return Toolbar;

});
/*jslint nomen: true, browser:true*/
/*global define */

define(['jquery', 'underscore', 'text!./toolbar-button-template.html', 'text!./toolbar-template.html', 'css!./toolbar' ], function ($, _, toolbarButtonTemplateStr, toolbarTemplateStr) {

    var toolbarButtonTemplate = _.template(toolbarButtonTemplateStr);
    var toolbarTemplate = _.template(toolbarTemplateStr);

    var Toolbar = function (parent, callbacks) {
        this._parent = $(parent);
        this.callbacks = callbacks;
        
        // compile toolbar template
        this._toolbar = $(toolbarTemplate());
        this._buttonWrapper = this._toolbar.find(".toolbar-button-wrapper");
        this._buttons = {};

        this._parent.append(this._toolbar);
        
        var button, label, first = true;
        for (label in this.callbacks) {
            if(first){
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
        
        // center the wrapper
        this._centerWrapper();
    };


    Toolbar.prototype = {
        get parent() {
            return this._parent;
        },
        
        // center the wrapper
        _centerWrapper: function () {
            var wrapperHeight = this._buttonWrapper.outerHeight(),
                toolbarHeight = this._toolbar.outerHeight();
            this._buttonWrapper.css({
                position: 'relative',
                top: toolbarHeight / 2 - wrapperHeight / 2
            });
        },
                
        _bindButtonHandlers: function(button, label){
            var callback = this.callbacks[label];            
            button.on({
                click:function(){
                    callback();
                },
                touchstart:function(){} // debug :active css pseudo class
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
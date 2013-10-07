/*jslint nomen: true, browser:true*/
/*global define */

define(['jquery', 'jstools/tools', 'text!./block-init-template.html', 'handlebars'], function ($, tools, template, Handlebars) {
    "use strict";

    function BlockInitView(parentView) {
        this._parentView = $(parentView);
        this._blockDiv = null;
        this._template = Handlebars.compile(template);
    }

    BlockInitView.prototype = {

        blockInit: function (blockinfo) {

            var dfd = $.Deferred(),
                compiledTemplate = this._template({
                    name: blockinfo.practice ? "Practice" : "Block " + (blockinfo.measure_block_number + 1),
                    values: blockinfo.values
                });
            var div = $(compiledTemplate);
            this._parentView.append(div);
            div.click(function () {
                dfd.resolve();
            });
            return dfd.done(function () {
                div.remove();
            });
        },
    };

    return BlockInitView;

});
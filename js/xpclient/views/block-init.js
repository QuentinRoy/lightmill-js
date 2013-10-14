define(['jquery', 'jstools/tools', 'text!./block-init-template.html', 'handlebars', 'fastclick'], function ($, tools, template, Handlebars, FastClick) {
    "use strict";

    function BlockInitView(parentView) {
        this._parentView = $(parentView);
        this._template = Handlebars.compile(template);
    }

    BlockInitView.prototype = {

        blockInit: function (blockinfo) {

            var dfd = $.Deferred(),
                compiledTemplate = this._template({
                    name: blockinfo.practice ? "Practice" : "Block " + (blockinfo.measure_block_number + 1),
                    values: blockinfo.values,
                    backgroundColor: blockinfo.practice ? '#025600' : '#563200'
                });
            var div = $(compiledTemplate);
            FastClick.attach(div[0]);
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
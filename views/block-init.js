define(['jquery', 'jstools/tools', 'text!./block-init-template.html', 'handlebars', 'fastclick', 'css!./main.css'], function ($, tools, template, Handlebars, FastClick) {
    'use strict';

    function BlockInitView(parentView) {
        this._parentView = $(parentView);
        this._template = Handlebars.compile(template);
    }

    BlockInitView.prototype = {

        blockInit: function (blockinfo) {

            var dfd = $.Deferred();
            
            // compile the template
            var compiledTemplate = this._template({
                    first : blockinfo.number == 1,
                    name  : blockinfo.practice ? 'Practice' : 'Block ' + (blockinfo.measure_block_number + 1),
                    values: blockinfo.values,
                    backgroundColor: blockinfo.practice ? '#025600' : '#563200'
                });
            var div = $(compiledTemplate);
            // append it to the parent view
            div.appendTo(this._parentView);
            // remove click mobile delay
            FastClick.attach(div[0]);
            // prevent any default events
            tools.preventDefaultOnTouch(div);
            // resolve on click
            div.click(function () {
                dfd.resolve();
            });
            // return
            return dfd.done(function () {
                div.remove();
            });
        },
    };

    return BlockInitView;

});
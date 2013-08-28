/*jslint nomen: true, browser:true*/
/*global define */

define(['jquery', 'jstools/tools', 'text!./block-init-template.html', 'underscore'], function ($, tools, template, underscore) {
    "use strict";

    function BlockInitView(parentView) {
        this._parentView = $(parentView);
        this._blockDiv = null;
        this._template = underscore.template(template);
    }

    BlockInitView.prototype = {

        blockInit: function (blockinfo) {
            //TODO: practice block !
            
            var dfd = $.Deferred(),
                compiledTemplate = this._template(blockinfo);
            var div = $(compiledTemplate);
            this._parentView.append(div);
            div.click(function(){
                dfd.resolve();
                div.remove();
            });
            return dfd;
        },
    };

    return BlockInitView;

});
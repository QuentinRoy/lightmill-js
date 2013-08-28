/*jslint nomen: true, browser:true*/
/*global define */

define(['jquery'],function($){
    "use strict";

    function InterViewsManager(parentView){
        this._parentView = parentView;
        this._blockDiv = this._createBlockDiv();
        this._waitingDiv = this._createWaitingDiv();
    }
    
    InterViewsManager.prototype = {
        _createBlockDiv:function(){},
        _createWaitingDiv:function(){},
        startWaiting:function(){},
        stopWaiting:function(){},
        blockInit:function(){
            var dfd = $.Deferred();
            //TODO: something there
            dfd.resolve();
            return dfd;
        },
    };

    return InterViewsManager;
    
});
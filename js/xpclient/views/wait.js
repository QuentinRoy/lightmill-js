/*jslint nomen: true, browser:true*/
/*global define */

define([],function(){
    "use strict";

    function WaitView(parentView){
        this._parentView = parentView;
    }
    
    WaitView.prototype = {
        startWaiting: function(){},
        stopWaiting: function(){}
    };

    return WaitView;
    
});
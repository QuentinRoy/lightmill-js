/*jslint nomen: true, browser:true*/
/*global define */

define(['spin', 'jquery'], function (Spinner, $) {
    "use strict";

    function WaitView(parentView) {
        this._parentView = parentView;
        this._spinView = $('<div class="full-parent"></div>');
        this._spinner = new Spinner(this._opts);
    }

    WaitView.prototype = {

        _opts: {
            lines: 11, // The number of lines to draw
            length: 20, // The length of each line
            width: 10, // The line thickness
            radius: 30, // The radius of the inner circle
            corners: 1, // Corner roundness (0..1)
            rotate: 0, // The rotation offset
            direction: 1, // 1: clockwise, -1: counterclockwise
            color: '#5C5C5C', // #rgb or #rrggbb or array of colors
            speed: 1, // Rounds per second
            trail: 60, // Afterglow percentage
            shadow: false, // Whether to render a shadow
            hwaccel: false, // Whether to use hardware acceleration
            className: 'spinner', // The CSS class to assign to the spinner
            zIndex: 2e9, // The z-index (defaults to 2000000000)
            top: 'auto', // Top position relative to parent in px
            left: 'auto' // Left position relative to parent in px
        },

        startWaiting: function () {
            this._spinView.appendTo(this._parentView);
            this._spinner.spin(this._spinView[0]);
        },
        stopWaiting: function () {
            this._spinner.stop();
            this._spinView.remove();
        }
    };

    return WaitView;

});
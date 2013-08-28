define(['jquery'], function ($) {

    function TaskManager() {

    }

    TaskManager.prototype = {

        createObject: function () {
            var objDiv = $("<div />"),
                size = 150;
            objDiv.css({
                width: size,
                height: size,
                "border-radius": size,
                "background-color": "#3231FF",
                "background-opacity": 0.7,
                "border-style": "solid",
                "border-width": 3,
                "border-color": "#494995"
            });
            return objDiv;
        },

        createTarget: function () {
            var targetDiv = $("<div />"),
                size = 160;
            targetDiv.css({
                width: size,
                height: size,
                "border-radius": size,
                "border-style": "solid",
                "border-width": 3,
                "border-color": "#4D954D"
            });
        },


        startTask: function (params, callback) {
            var dfd = $.Deferred().done(callback);

            setTimeout(function () {
                dfd.resolve({
                    test: true,
                    execution: null
                });
            }, 10);
            
            return dfd;
        },

    };

    return TaskManager;

});
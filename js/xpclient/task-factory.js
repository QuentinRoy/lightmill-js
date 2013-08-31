/*jslint nomen: true, browser:true*/
/*global define */

define(['./test-task'], function (TestTask) {


    function TaskFactory(taskDiv) {
        this.taskDiv = taskDiv;
    }

    TaskFactory.prototype = {
        createTask: function (params) {
            return new TestTask(this.taskDiv, params);
        },

        startTask: function (params) {
            return this.createTask(params).start();
        },
    };

    return TaskFactory;
});
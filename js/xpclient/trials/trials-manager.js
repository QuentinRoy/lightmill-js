/*jslint nomen: true, browser:true*/
/*global define */

define(['./sm-test-task'], function (SigmaMenuTestTask) {


    function TaskFactory(taskDiv) {
        this.taskDiv = taskDiv;
    }

    TaskFactory.prototype = {
        createTask: function (params) {
            return new SigmaMenuTestTask(this.taskDiv, params);
        },

        startTask: function (params) {
            return this.createTask(params).start();
        },
    };

    return TaskFactory;
});
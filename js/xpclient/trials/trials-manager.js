/*jslint nomen: true, browser:true*/
/*global define */

define(['./sm-test-task', './tb-test-task'], function (SigmaMenuTestTask, ToolbarTestTask) {


    function TaskFactory(taskDiv) {
        this.taskDiv = taskDiv;

        this.taskConstructors = {
            SigmaMenu: SigmaMenuTestTask,
            Toolbar: ToolbarTestTask,
            FingerMenu: SigmaMenuTestTask // TODO change that
        };
    }

    TaskFactory.prototype = {
        
        createTask: function (params) {
            var technique = params.block_values.technique || params.values.technique,
                constructor = this.taskConstructors[technique];
            return new constructor(this.taskDiv, params);
        },

        startTask: function (params) {
            return this.createTask(params).start();
        },
    };

    return TaskFactory;
});
define(['./sm-test-task', './tb-test-task', './fm-test-task'], function (SigmaMenuTestTask, ToolbarTestTask, FingerMenuTestTask) {
    "use strict";

    function TaskFactory(taskDiv) {
        this.taskDiv = taskDiv;

        this.taskConstructors = {
            SigmaMenu: SigmaMenuTestTask,
            Toolbar: ToolbarTestTask,
            FingerMenu: FingerMenuTestTask
        };
    }

    TaskFactory.prototype = {
        
        createTask: function (params) {
            /*jshint newcap: false */
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
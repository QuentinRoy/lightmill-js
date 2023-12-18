# @lightmill/react-experiment

## 3.0.0-beta.30

### Patch Changes

- 3b71a26: Fix Run props type regression introduced in 6ee33d3d21882c2e6d8cc12ec0cfda5506fce46a.

## 3.0.0-beta.29

### Patch Changes

- 6ee33d3: Run's elements prop must now support every tasks in timeline, even when no task types have been provided or registered
- f6a7a82: Fix tasks being skipped when onTaskCompleted is called several times.

## 3.0.0-beta.25

### Major Changes

- f01d46f: Rename Run log prop to onLog

### Minor Changes

- 7696b2f: Add log content in use logger typing with default values.

### Patch Changes

- 2d3d87e: Remove package.json engines directive which fixes a warning when consumer uses a different node version.
- Updated dependencies [2d3d87e]
  - @lightmill/runner@3.0.0-beta.25

## 3.0.0-beta.23

### Minor Changes

- aed9788: Add resumeAfter Run prop

### Patch Changes

- Updated dependencies [aed9788]
  - @lightmill/runner@3.0.0-beta.23

## 3.0.0-beta.21

### Major Changes

- b3aec3a: Do not flush before completing a run, and do not require loggers to define a flush method.

## 3.0.0-beta.20

### Major Changes

- e3774ba: Rename Run's config prop to elements, and RunConfig type to RunElements

### Patch Changes

- 858914e: Fix logger's run not being marked as completed under run completion.

## 3.0.0-beta.19

### Minor Changes

- 6753790: manage logger errors, add Run's error property, and add useError hook

## 3.0.0-alpha.15

### Major Changes

- f2a2a74: Change API: fix run being canceled on unmount, rename useLog to useLogger, remove noConfirmOnUnload Run prop, add confirmBeforeUnload and cancelRunOnUnload Run props

## 3.0.0-alpha.13

### Major Changes

- b483585: Rename Experiment to Run to be coherent with log-server's terminology

### Minor Changes

- 0185591: Add logger support

## 3.0.0-alpha.11

### Patch Changes

- a40cb71: Fix dependencies

## 3.0.0-alpha.9

### Major Changes

- efab3bc: Creation of @lightmill/react-experiment

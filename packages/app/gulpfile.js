const gulp = require('gulp');
const rename = require('gulp-rename');
const rollupEach = require('gulp-rollup-each');
const sass = require('gulp-sass');
const pug = require('rollup-plugin-pug');
const resolve = require('rollup-plugin-node-resolve');
const del = require('del');

gulp.task('views', () =>
  gulp
    .src('src/**/*.pug')
    .pipe(
      rollupEach({
        output: {
          format: 'es'
        },
        plugins: [resolve(), pug({ pugRuntime: 'pug-runtime' })],
        external: ['pug-runtime']
      })
    )
    .pipe(rename({ extname: '.pug.js' }))
    .pipe(gulp.dest('esm'))
);

gulp.task('css', () =>
  gulp
    .src('src/views/**/*.scss')
    .pipe(sass().on('error', sass.logError))
    .pipe(gulp.dest('esm'))
);

gulp.task('js', () => gulp.src('src/**/*.js').pipe(gulp.dest('esm')));

gulp.task('build-esm', gulp.parallel('views', 'css', 'js'));

gulp.task('clean-esm', () => del(['esm/**']));

gulp.task('default', gulp.series('clean-esm', 'build-esm'));

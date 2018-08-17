const { mkdirs, writeFile } = require('fs-extra');
const path = require('path');

const template = (target, { withNamed = true, withDefault = false } = {}) => {
  const namedExports = withNamed ? `export * from '${target}';\n` : '';
  const defaultExports = withDefault
    ? `export { default } from '${target}';\n`
    : '';
  return namedExports + defaultExports;
};

const {
  s: source,
  o: output,
  d: withDefault,
  n: withNamed
} = require('minimist')(process.argv.slice(2));

let failed = false;
if (!source) {
  failed = true;
  process.stderr.write('A source file is required (-s).');
}
if (!output) {
  failed = true;
  process.stderr.write('An output file is required (-s).');
}
if (!withDefault && !withNamed) {
  failed = true;
  process.stderr.write(
    'Nothing to export! Specify at least one of named (-n) or default (-d) exports\n'
  );
}
if (failed) process.exit(1);

const targetDir = path.dirname(output);
const sourcePathFromOutput = path.relative(path.dirname(output), source);

mkdirs(targetDir)
  .then(() =>
    writeFile(
      output,
      template(sourcePathFromOutput, { withDefault, withNamed })
    )
  )
  .then(() => process.stderr.write(`created ${output}.\n`))
  .catch(e => {
    // Write stderr as it is info not actual output of the program as per
    // UNIX convention.
    process.stderr.write(e.message);
    process.exit(1);
  });

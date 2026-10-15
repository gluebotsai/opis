import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

const banner = '/*! WorktualAnalytics v3.0.0 | (c) Worktual */';

export default [
  {
    input: 'src/index.js',
    output: [
      { file: 'dist/webtracking.js', format: 'iife', name: 'WorktualAnalytics', banner },
      { file: 'dist/webtracking.esm.js', format: 'es', banner },
    ],
    plugins: [resolve()],
  },
  {
    input: 'src/index.js',
    output: { file: 'dist/webtracking.min.js', format: 'iife', name: 'WorktualAnalytics', banner },
    plugins: [
      resolve(),
      terser({
        compress: true,
        mangle: true,
        format: { comments: /^!/, beautify: true, indent_level: 2 },
      }),
    ],
  },
];

/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

import path from 'path';

/**
 * Promisified version of compiler.runAsChild() with error hoisting and isolated output/assets.
 * (runAsChild() merges assets into the parent compilation, we don't want that)
 */
export function runChildCompiler (compiler) {
  return new Promise((resolve, reject) => {
    compiler.compile((err, compilation) => {
      // still allow the parent compiler to track execution of the child:
      compiler.parentCompilation.children.push(compilation);
      if (err) return reject(err);

      // Bubble stat errors up and reject the Promise:
      if (compilation.errors && compilation.errors.length) {
        const errorDetails = compilation.errors.map(error => error.details).join('\n');
        return reject(Error('Child compilation failed:\n' + errorDetails));
      }

      resolve(compilation);
    });
  });
}

/** Crawl up the compiler tree and return the outermost compiler instance */
export function getRootCompiler (compiler) {
  while (compiler.parentCompilation && compiler.parentCompilation.compiler) {
    compiler = compiler.parentCompilation.compiler;
  }
  return compiler;
}

/** Find the best possible export for an ES Module. Returns `undefined` for no exports. */
export function getBestModuleExport (exports) {
  if (exports.default) {
    return exports.default;
  }
  for (const prop in exports) {
    if (prop !== '__esModule') {
      return exports[prop];
    }
  }
}

/** Wrap a String up into an ES Module that exports it */
export function stringToModule (str) {
  return 'export default ' + JSON.stringify(str);
}

export function convertPathToRelative (context, entry, prefix = '') {
  if (Array.isArray(entry)) {
    return entry.map(entry => prefix + path.relative(context, entry));
  } else if (entry && typeof entry === 'object') {
    return Object.keys(entry).reduce((acc, key) => {
      acc[key] = Array.isArray(entry[key])
        ? entry[key].map(item => prefix + path.relative(context, item))
        : prefix + path.relative(context, entry[key]);
      return acc;
    }, {});
  }
  return prefix + path.relative(context, entry);
}

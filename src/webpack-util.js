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

import SingleEntryPlugin from 'webpack/lib/SingleEntryPlugin';
import MultiEntryPlugin from 'webpack/lib/MultiEntryPlugin';

/** Handle "object", "string" and "array" types of entry */
export function applyEntry (context, entry, compiler) {
  if (typeof entry === 'string' || Array.isArray(entry)) {
    itemToPlugin(context, entry, 'main').apply(compiler);
  } else if (typeof entry === 'object') {
    Object.keys(entry).forEach(name => {
      itemToPlugin(context, entry[name], name).apply(compiler);
    });
  }
}

function itemToPlugin (context, item, name) {
  if (Array.isArray(item)) {
    return new MultiEntryPlugin(context, item, name);
  }

  return new SingleEntryPlugin(context, item, name);
}

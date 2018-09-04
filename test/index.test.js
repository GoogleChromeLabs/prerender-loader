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
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { compile, compileToHtml, readFile } from './_helpers';

const PRERENDER_LOADER = path.resolve(__dirname, '../src');

const configure = prerenderLoaderOptions => config => {
  let template = path.resolve(config.context, 'index.html');
  if (prerenderLoaderOptions === true) {
    template = `!!${PRERENDER_LOADER}?string!${template}`;
  } else if (prerenderLoaderOptions) {
    template = `!!${PRERENDER_LOADER}?${JSON.stringify(prerenderLoaderOptions)}!${template}`;
  } else {
    template = `!!raw-loader!${template}`;
  }
  config.plugins.push(
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template,
      compile: false,
      inject: true,
      minify: {
        collapseWhitespace: true,
        preserveLineBreaks: true
      }
    })
  );
};

const withoutPrerender = configure(false);
const withPrerender = configure(true);

describe('webpack compilation smoke test (no prerendering)', () => {
  it('should compile', async () => {
    const info = await compile('fixtures/basic/index.js', withoutPrerender);
    expect(info.assets).toHaveLength(2);

    const html = await readFile('fixtures/basic/dist/index.html');
    expect(html).toMatchSnapshot();
  });

  it('should compile named entries', async () => {
    const info = await compile('fixtures/basic/index.js', config => {
      config = withoutPrerender(config) || config;
      config.entry = { app: config.entry };
      return config;
    });
    expect(info.assets).toHaveLength(2);

    const html = await readFile('fixtures/basic/dist/index.html');
    expect(html).toMatchSnapshot();
  });

  it('should compile array entries', async () => {
    const info = await compile('fixtures/basic/index.js', config => {
      config = withoutPrerender(config) || config;
      config.entry = [config.entry];
      return config;
    });
    expect(info.assets).toHaveLength(2);

    const html = await readFile('fixtures/basic/dist/index.html');
    expect(html).toMatchSnapshot();
  });

  it('should propagate child compiler errors', async () => {
    await expect(compile('fixtures/failure/index.js', withPrerender)).rejects.toMatch(/does-not-exist/);
  });
});

describe('prerender-loader!x.html', () => {
  describe('?disabled', async () => {
    const { html } = await compileToHtml('basic', configure({ disabled: true, string: true }));
    expect(html).not.toMatch(/<div>this counts as SSR<\/div>/);
  });

  describe('Imperative DOM, no {{prerender}} field', () => {
    it('should return serialized HTML', async () => {
      const { html, document } = await compileToHtml('basic', withPrerender);

      // verify that our DOM-generated content has been prerendered into the static HTML:
      expect(html).toMatch(/<div>this counts as SSR<\/div>/);
      // ... and that there's no extra children:
      expect(document.body.children).toHaveLength(2);
      // ... and that html-webpack-plugin was able to inject scripts after the content:
      expect(document.body.firstElementChild).toHaveProperty('outerHTML', '<div>this counts as SSR</div>');
      expect(html).toMatchSnapshot();
    });
  });

  describe('default export function, no {{prerender}} field', () => {
    it('should inject returned HTML into <body>', async () => {
      const { html, document } = await compileToHtml('factory', withPrerender);

      // verify that our DOM-generated content has been prerendered into the static HTML:
      expect(html).toMatch(/<div>some returned HTML<\/div>/);
      // ... and that there's no extra children:
      expect(document.body.children).toHaveLength(2);
      // ... and that html-webpack-plugin was able to inject scripts after the content:
      expect(document.body.firstElementChild).toHaveProperty('outerHTML', '<div>some returned HTML</div>');
      expect(html).toMatchSnapshot();
    });
  });

  describe('default export function, with {{prerender}} field', () => {
    // <div>some returned HTML</div>
    it('should inject returned HTML in place of {{prerender}}', async () => {
      const { html, document } = await compileToHtml('with-field', withPrerender);

      // verify that our DOM-generated content has been prerendered into the static HTML:
      expect(html).toMatch(/<div>more returned HTML<\/div>/);
      expect(document.body.children).toHaveLength(2);
      // verify our the wrapper element that contained {{prerender}} is still present:
      expect(document.body.firstElementChild).toHaveProperty('id', 'wrapper');
      // verify the wrapper element contains all of the prerendered content:
      expect(document.getElementById('wrapper').innerHTML).toMatch(/^\s*<div>more returned HTML<\/div>\s*$/);
      expect(html).toMatchSnapshot();
    });
  });

  describe('named export function', () => {
    it('should invoke the only named export', async () => {
      const { html } = await compileToHtml('named-export-fn', withPrerender);
      expect(html).toMatch(/<div>some HTML returned from prerender\(\)<\/div>/);
    });
  });

  describe('exported value', () => {
    it('should invoke the only named export', async () => {
      const { html } = await compileToHtml('value-export', withPrerender);
      expect(html).toMatch(/<div>this is the resolved value of PRERENDERED_HTML<\/div>/);
    });
  });

  describe('exported function with no return value', () => {
    it('should serialize the whole document', async () => {
      const { html, document } = await compileToHtml('function-export-dom', withPrerender);
      expect(html).toMatch(/<div>content injected into the dom<\/div>/);
      expect(document.body.children).toHaveLength(2);
      expect(html).toMatchSnapshot();
    });
  });

  const DOCUMENT_URL = 'http://localhost/page';

  describe(`?documentUrl=${DOCUMENT_URL}`, () => {
    it('should set the value returned by window.location', async () => {
      const { document } = await compileToHtml('document-url', configure({ string: true, documentUrl: DOCUMENT_URL }));

      // verify that our DOM-generated content has been prerendered into the static HTML:
      expect(document.body.firstElementChild).toHaveProperty('outerHTML', `<div>${DOCUMENT_URL}</div>`);
    });
  });
});

<p align="center">
  <img src="https://i.imgur.com/BL0lf5F.png" width="240" height="240" alt="prerender-loader">
  <h1 align="center">
    prerender-loader
    <a href="https://www.npmjs.org/package/prerender-loader"><img src="https://img.shields.io/npm/v/prerender-loader.svg?style=flat" alt="npm"></a>
  </h1>
</p>

Painless universal prerendering for Webpack. Works great with
[html-webpack-plugin].

> 🧐 **What is Prerendering?**
>
>Pre-rendering describes the process of rendering a client-side application at
>build time, producing useful static HTML that can be sent to the browser
>instead of an empty bootstrapping page.
>
>Pre-rendering is like Server-Side Rendering, just done at build time to produce
>static files. Both techniques help get meaningful content onto the user's
>screen faster.

## Features

-   Works entirely within Webpack
-   Integrates with [html-webpack-plugin]
-   Works with `webpack-dev-server` / `webpack serve`
-   Supports both DOM and String prerendering
-   Asynchronous rendering via async/await or Promises

---

<!-- TOC depthFrom:2 -->

- [Features](#features)
- [How does it work?](#how-does-it-work)
- [Installation](#installation)
- [Usage](#usage)
  - [DOM Prerendering](#dom-prerendering)
  - [String Prerendering](#string-prerendering)
  - [Injecting content into the HTML](#injecting-content-into-the-html)
  - [Prerendering JavaScript Files](#prerendering-javascript-files)
- [Options](#options)
- [License](#license)

<!-- /TOC -->

## How does it work?

`prerender-loader` renders your web application within Webpack during builds,
producing static HTML. When the loader is applied to an HTML file, it creates a
DOM structure from that HTML, compiles the application, runs it within the DOM
and serializes the result back to HTML.

---

## Installation

First, install `prerender-loader` as a development dependency:

```sh
npm i -D prerender-loader
```

---

## Usage

In most cases, you'll want to apply the loader to your `html-webpack-plugin`
template option:

```diff
// webpack.config.js
module.exports = {
  plugins: [
    new HtmlWebpackPlugin({
-     template: 'index.html',
+     template: '!!prerender-loader?string!index.html',

      // any other options you'd normally set are still supported:
      compile: false,
      inject: true
    })
  ]
}
```

What does all that punctuation mean? Let's break the whole loader string
down:

> In Webpack, a module identifier beginning with `!!` will bypass any configured
>loaders from `module.rules` - here we're saying "don't do anything to
>`index.html` except what I've defined here
>
>The `?string` parameter tells `prerender-loader` to output an ES module
>exporting the prerendered HTML string, rather than returning the HTML directly.
>
>Finally, everything up to the last `!` in a module identifier is the inline
>loader definition (the transforms to apply to a given module).  The filename of
>the module to load comes after the `!`.
>
>**Note:** If you've already set up `html-loader` or `raw-loader` to handle
>`.html` files, you can skip both options and simply pass a `template` value of
>`"prerender-loader!index.html"`!

As with any loader, it is also possible to apply `prerender-loader` on-the-fly
:

```js
const html = require('prerender-loader?!./app.html');
```

... or in your Webpack configuration's `module.rules` section:

```js
module.exports = {
  module: {
    rules: [
      {
        test: 'src/index.html',
        loader: 'prerender-loader?string'
      }
    ]
  }
}
```


Once you have `prerender-loader` in-place, prerendering is now turned on. During
your build, the app will be executed, with any modifications it makes to
`index.html` will be saved to disk.  This is fine for the needs of many apps,
but you can also take more explicit control over your prerendering: either using
the DOM or by rendering to a String.

### DOM Prerendering

During prerendering, your application gets compiled and run directly under
NodeJS, but within a [JSDOM] container so that you can use the familiar browser
globals like `document` and `window`.

Here's an example `entry` module that uses DOM prerendering:

```js
import { render } from 'fancy-dom-library';
import App from './app';

export default () => {
  render(<App />, document.body);
};
```

In all cases, asynchronous functions and callbacks are supported:

```js
import { mount } from 'other-fancy-library';
import app from './app';

export default async function prerender() {
  let res = await fetch('https://example.com');
  let data = await res.json();
  mount(app(data), document.getElementById('app'));
}
```

### String Prerendering

It's also possible to export a function from your Webpack entry module, which
gives you full control over prerendering: `prerender-loader` will call the
function and its return value will be used as the static HTML.  If the exported
function returns a Promise, it will be awaited and the resolved value will be
used.

```js
import { renderToString } from 'react-dom';
import App from './app';

export default () => {
  const html = renderToString(<App />);
  // returned HTML will be injected into <body>:
  return html;
};
```

In addition to DOM and String prerendering, it's also possible to use a
combination of the two.  If an application's Webpack entry exports a prerender
function that doens't return a value, the default DOM serialization will kick
in, just like in DOM prerendering. This means you can use your exported
prerender function to trigger DOM manipulation ("client-side" rendering), and
then just let `prerender-loader` handle generating the static HTML for whatever
got rendered.

Here's an example that renders a [Preact] application and waits for DOM
rendering to settle down before allowing prerender-loader to serialize the
document to static HTML:

```js
import { h, options } from 'preact';
import { renderToString } from 'preact';
import App from './app';

// we're done when there are no renders for 50ms:
const IDLE_TIMEOUT = 50;

export default () => new Promise(resolve => {
  let timer;
  // each time preact re-renders, reset our idle timer:
  options.debounceRendering = commit => {
    clearTimeout(timer);
    timer = setTimeout(resolve, IDLE_TIMEOUT);
    commit();
  };

  // render into <body> using normal client-side rendering:
  render(<App />, document.body);
});
```

### Injecting content into the HTML

When applied to a `.html` file, `prerender-loader` will inject prerendered
content at the end of `<body>` by default.  If you want to place the content
somewhere else, you can add a `{{prerender}}` field:

```html
<html>
  <body>
    <div id="app_root">
      <!-- Inject any pre-rendered HTML here: -->
      {{prerender}}
    </div>
  </body>
</html>
```

This works well if you intend to provide a prerender function that only returns
your application's HTML structure, not the full document's HTML.

### Prerendering JavaScript Files

In addition to processing `.html` files, the loader can also directly pre-render
`.js` scripts. The only difference is that the DOM used for prerender will be
initially empty:

```js
const prerenderedHtml = require('!prerender-loader?string!./app.js');
```

---

## Options

All options are ... optional.

| Option        | Type    | Default            | Description                                                            |
| ------------- | ------- | ------------------ | ---------------------------------------------------------------------- |
| `string`      | boolean | false              | Output a JS module exporting an HTML String instead of the HTML itself |
| `disabled`    | boolean | false              | Bypass the loader entirely (but still respect `options.string`)        |
| `documentUrl` | string  | 'http://localhost' | Change the jsdom's URL (affects `window.location`, `document.URL`...)  |
| `params`      | object  | null               | Options to pass to your prerender function                             |


---

## License

[Apache 2.0](LICENSE)

This is not an official Google product.

[html-webpack-plugin]: https://github.com/jantimon/html-webpack-plugin
[JSDOM]: https://github.com/jsdom/jsdom
[Preact]: https://preactjs.com

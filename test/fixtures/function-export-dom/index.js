export default () => new Promise(resolve => {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode('content injected into the dom'));
  document.body.appendChild(div);

  setTimeout(() => {
    resolve();
  }, 10);
});

/*eslint no-cond-assign:0*/
import Jed from 'jed';
import React from 'react';
import {sprintf} from 'sprintf-js';
import _ from 'lodash';
import {css} from 'react-emotion';

import {getTranslations} from 'app/translations';

let LOCALE_DEBUG = false;

const sessionStorage = window.sessionStorage;
if (sessionStorage && sessionStorage.getItem('localeDebug') == '1') {
  LOCALE_DEBUG = true;
}

const markerCss = css`
  background: #ff801790;
  outline: 2px solid #ff801790;
`;

export function setLocaleDebug(value) {
  sessionStorage.setItem('localeDebug', value ? '1' : '0');
  /*eslint no-console:0*/
  console.log(`Locale debug is: ${value ? 'on' : 'off'}. Reload page to apply changes!`);
}

export function toggleLocaleDebug(value) {
  const currentValue = sessionStorage.getItem('localeDebug');
  setLocaleDebug(currentValue !== '1');
  window.location.reload();
}

let i18n = null;

export function setLocale(locale) {
  const translations = getTranslations(locale);
  i18n = new Jed({
    domain: 'sentry',
    missing_key_callback: function(key) {},
    locale_data: {
      sentry: translations,
    },
  });
}

setLocale('en');

function formatForReact(formatString, args) {
  const rv = [];
  let cursor = 0;

  // always re-parse, do not cache, because we change the match
  sprintf.parse(formatString).forEach((match, idx) => {
    if (_.isString(match)) {
      rv.push(match);
    } else {
      let arg = null;
      if (match[2]) {
        arg = args[0][match[2][0]];
      } else if (match[1]) {
        arg = args[parseInt(match[1], 10) - 1];
      } else {
        arg = args[cursor++];
      }

      // this points to a react element!
      if (React.isValidElement(arg)) {
        rv.push(React.cloneElement(arg, {key: idx}));
        // not a react element, fuck around with it so that sprintf.format
        // can format it for us.  We make sure match[2] is null so that we
        // do not go down the object path, and we set match[1] to the first
        // index and then pass an array with two items in.
      } else {
        match[2] = null;
        match[1] = 1;
        rv.push(<span key={idx++}>{sprintf.format([match], [null, arg])}</span>);
      }
    }
  });

  return rv;
}

function argsInvolveReact(args) {
  if (args.some(React.isValidElement)) {
    return true;
  }
  if (args.length == 1 && _.isObject(args[0])) {
    return Object.keys(args[0]).some(key => {
      return React.isValidElement(args[0][key]);
    });
  }
  return false;
}

export function parseComponentTemplate(string) {
  const rv = {};

  function process(startPos, group, inGroup) {
    const regex = /\[(.*?)(:|\])|\]/g;
    let match;
    const buf = [];
    let satisfied = false;

    let pos = (regex.lastIndex = startPos);
    while ((match = regex.exec(string)) !== null) {
      const substr = string.substr(pos, match.index - pos);
      if (substr !== '') {
        buf.push(substr);
      }

      if (match[0] == ']') {
        if (inGroup) {
          satisfied = true;
          break;
        } else {
          pos = regex.lastIndex;
          continue;
        }
      }

      if (match[2] == ']') {
        pos = regex.lastIndex;
      } else {
        pos = regex.lastIndex = process(regex.lastIndex, match[1], true);
      }
      buf.push({group: match[1]});
    }

    let endPos = regex.lastIndex;
    if (!satisfied) {
      const rest = string.substr(pos);
      if (rest) {
        buf.push(rest);
      }
      endPos = string.length;
    }

    rv[group] = buf;
    return endPos;
  }

  process(0, 'root', false);

  return rv;
}

export function renderComponentTemplate(template, components) {
  let idx = 0;
  function renderGroup(group) {
    const children = [];

    (template[group] || []).forEach(item => {
      if (_.isString(item)) {
        children.push(<span key={idx++}>{item}</span>);
      } else {
        children.push(renderGroup(item.group));
      }
    });

    // in case we cannot find our component, we call back to an empty
    // span so that stuff shows up at least.
    let reference = components[group] || <span key={idx++} />;
    if (!React.isValidElement(reference)) {
      reference = <span key={idx++}>{reference}</span>;
    }

    if (children.length > 0) {
      return React.cloneElement(reference, {key: idx++}, children);
    } else {
      return React.cloneElement(reference, {key: idx++});
    }
  }

  return renderGroup('root');
}

function mark(rv) {
  if (!LOCALE_DEBUG) {
    return rv;
  }

  const proxy = {
    $$typeof: Symbol.for('react.element'),
    type: 'span',
    key: null,
    ref: null,
    props: {
      className: markerCss,
      children: _.isArray(rv) ? rv : [rv],
    },
    _owner: null,
    _store: {},
  };

  proxy.toString = function() {
    return '???' + rv + '???';
  };

  return proxy;
}

export function format(formatString, args) {
  if (argsInvolveReact(args)) {
    return formatForReact(formatString, args);
  } else {
    return sprintf(formatString, ...args);
  }
}

export function gettext(string, ...args) {
  let rv = i18n.gettext(string);
  if (args.length > 0) {
    rv = format(rv, args);
  }
  return mark(rv);
}

export function ngettext(singular, plural, ...args) {
  let countArg;
  if (args.length > 0) {
    countArg = args[0] || 0;
    args = [countArg.toLocaleString(), ...args.slice(1)];
  } else {
    countArg = 0;
  }

  return mark(format(i18n.ngettext(singular, plural, countArg), args));
}

/* special form of gettext where you can render nested react
   components in template strings.  Example:

      gettextComponentTemplate('Welcome. Click [link:here]', {
        root: <p/>,
        link: <a href="#" />
      });

   the root string is always called "root", the rest is prefixed
   with the name in the brackets */
export function gettextComponentTemplate(template, components) {
  const tmpl = parseComponentTemplate(i18n.gettext(template));
  return mark(renderComponentTemplate(tmpl, components));
}

export const t = gettext;
export const tn = ngettext;
export const tct = gettextComponentTemplate;

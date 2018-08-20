# @lightmill/convert-touchstone

Convert a touchstone XML design file as produce by [touchstone](https://www.lri.fr/%7Eappert/website/touchstone/touchstone.html)'s [design platform](https://github.com/jdfekete/touchstone-platforms/tree/master/design-platform) to a format that can be directly provided to [@lightmill/static-design](../static-design).

## Install

### NPM

```sh
npm install @lightmill/convert-touchstone
```

Note: You might not need to install @lightmill/convert-touchstone, [`npx`](https://www.npmjs.com/package/npx) can be used to download and immediately run the program.

### Direct download

Download the latest version then, then in your html file:

```html
<script src="lightmill-convert-touchstone.js"></script>
```

The library will be injected in `lightmill.convertTouchstone`.

## Usage

```sh
lightmill-convert-touchstone <input-file>
```

Or (if you do not need to install it and prefer to use `npx`):

```sh
npx @lightmill/convert-touchstone <input-file>
```

## API

### convertTouchstone(touchStoneXML, [options]) ⇒ <code>Promise.&lt;object&gt;</code>
**Returns**: <code>Promise.&lt;object&gt;</code> - The experimental design converted into a format
supported by @lightmill/static-design.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| touchStoneXML | <code>String</code> \| <code>stream.Readable</code> |  | The XML to parse. |
| [options] | <code>object</code> |  | Options |
| [options.blockStartupType] | <code>string</code> | <code>&quot;&#x27;block-startup&#x27;&quot;</code> | The type of the task to insert at each block startup. Set to null to disable block startup tasks. |
| [options.trialType] | <code>string</code> | <code>&quot;&#x27;trial&#x27;&quot;</code> | The type of trial's task. |
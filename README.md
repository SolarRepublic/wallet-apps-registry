# Wallet Apps Registry

A publicly-accessible, source-decentralized indexer that harvests metadata directly from Apps' websites and publishes them here as a centralized JSON registry where wallets can discover apps operating on specific blockchains.


## Registering an App

This repository is configured with GitHub actions to automatically fetch metadata from Apps' websites and update the [global.json](global.json) file multiple times per day.

In order to register an App, all you have to do is open a PR to add an empty `.url` file under [sources/](sources/) that references the website by its hostname. That's it! Anyone can register an app.

For example, an empty file called `app.example.net.url` will trigger the indexer to make a request to `https://app.example.net/`.

As a basic requirement, all websites MUST:
 - be using HTTPS offering TLS 1.2 or TLS 1.3 and serving a valid certificate
 - in response to `GET /`, return an HTTP response with a 2xx status code **OR** 3xx redirect to a path on the same origin
 - include the `Content-Type` HTTP header with a value of `text/html` and contain a valid HTML document in the response body

For indexing purposes, the website MUST provide the following metadata in the `<head>` of the HTML document:
 - App name and app icon via any of the following means (ordered by descending precedence):
  - Implement the [WHIP-002](https://github.com/SolarRepublic/WHIPs/blob/main/WHIPs/whip-002.md) specification (recommended)
  - **OR** embed a valid [Web app manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest) that includes the `short_name` property and an SVG image entry under `icons`
 - Identify which blockchain(s) it operates on via the [WHIP-003](https://github.com/SolarRepublic/WHIPs/blob/main/WHIPs/whip-003.md) specification

The website MAY also provide the following optional metadata:
 - App description via any of the following means (ordered by descending precedence):
  - Use the [`<meta name="description" ...>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta/name) element (recommended)
  - **OR** use the `<meta name="og:description" ...>` element from [the Open Graph protocol](https://ogp.me/)
  - **OR** embed a valid [Web app manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest) that includes the `description` property


## Updating an App

This indexer will automatically pull the latest metadata from your website every few hours, giving you full control of your own metadata. This is what 'source-decentralized' means. Registering with this repository is set-and-forget!

If your website updates and no longer meets the requirements, it will be removed from the published JSON. As soon as it meets the requirements again, it will automatically be re-added to the published JSON again.


## Accessing the published JSON registry

The latest published JSON registry is available at the persistent URL:
```txt
https://raw.githubusercontent.com/SolarRepublic/wallet-apps-registry/main/global.json
```

The schema of this file is described in the following typings:
```ts
type AppEntry = {
	name: string;
	description: string;
	icon: `https://raw.githubusercontent.com/SolarRepublic/wallet-apps-registry/main/cache/${string}.svg`;
};

type WalletAppsRegistryJson = Array<AppEntry>;
```


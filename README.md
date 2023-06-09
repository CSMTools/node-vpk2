# node-vpk2
Extractor and creator for the Valve Pack Format.

### Prerequisites
**Requires Node v13.2.0 and higher.**
Requires jBinary and crc, but npm/yarn will install them automatically if you follow these instructions.

### Installing
NPM:
```sh
npm install vpk2
```
Yarn:
```sh
yarn add vpk2
```
### How to use

To extract a V1/V2 VPK:
```js
import { VPK } from "vpk2";

// load a vpk (V1/V2) (ALWAYS select the _dir file)
let my_vpk = new VPK("FILE_LOCATION_HERE");
my_vpk.load();

// extract it
my_vpk.extract("FILE_LOCATION_HERE");
```

To create a V1 VPK (V2 is not currently supported):
```js
import { VPKcreator } from "vpk2";

// Load a directory
var my_vpk = new VPKcreator("FILE_LOCATION_HERE");
my_vpk.load();

// Save it as .vpk
my_vpk.save("FILE_LOCATION_HERE");
```

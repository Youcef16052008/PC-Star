/** Enregistrement du chargeur JSX pour `node --test` (voir jsx-test-loader.mjs). */
import { register } from 'node:module'

register('./jsx-test-loader.mjs', import.meta.url)

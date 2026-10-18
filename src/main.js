import { createApp } from 'vue'
import App from './App.vue'
import { randomizeFoliageAssets, state as treeState } from './store/treeStore.js'
import './style.css'

randomizeFoliageAssets(treeState.params.seed)
createApp(App).mount('#app')

import { createApp } from 'vue'
import App from './App.vue'
import { randomizeFoliageAssets } from './store/treeStore.js'
import './style.css'

randomizeFoliageAssets()
createApp(App).mount('#app')

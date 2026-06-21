import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

import LauncherView from '../views/LauncherView.vue';
import WorkspaceView from '../views/WorkspaceView.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'launcher',
    component: LauncherView,
    meta: {
      title: 'Oh Awesome Novel',
    },
  },
  {
    path: '/model',
    name: 'launcher-model',
    component: LauncherView,
    meta: {
      title: 'Model Settings',
    },
  },
  {
    path: '/about',
    name: 'launcher-about',
    component: LauncherView,
    meta: {
      title: 'About',
    },
  },
  {
    path: '/settings',
    name: 'launcher-settings',
    component: LauncherView,
    meta: {
      title: 'Settings',
    },
  },
  {
    path: '/workspace',
    name: 'workspace',
    component: WorkspaceView,
    meta: {
      title: 'Workspace',
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'launcher' },
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

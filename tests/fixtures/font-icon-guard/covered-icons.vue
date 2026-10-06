<template>
  <MsIcon name="home" />
  <ms-icon v-bind:name="cat.icon" />
  <span class="material-symbols-rounded">{{ active ? 'category' : 'weekend' }}</span>
</template>

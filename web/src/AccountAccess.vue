<script setup>
import { ref } from 'vue'
const email = ref(''), sending = ref(false), sent = ref(false), error = ref('')
async function send() {
  sending.value = true; error.value = ''
  try {
    const response = await fetch('/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Sign-in link could not be sent')
    sent.value = true
  } catch (cause) { error.value = cause.message }
  finally { sending.value = false }
}
</script>
<style scoped>
.guide-link{display:inline-block;color:#e8d17e;margin-top:18px;font-size:13px}
</style>
<template><section class="access"><span>WELCOME TO XAYLO</span><h1>Your marketing, understood.</h1><p>Create an account or sign in with a secure email link. Connect your website, Google Ads, or HighLevel when you’re ready.</p><form @submit.prevent="send"><label>Email address<input v-model="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@yourbusiness.com"></label><button :disabled="sending">{{ sending ? 'Sending…' : 'Email me a sign-in link' }}</button></form><p v-if="sent" role="status">Check your email. The sign-in link expires in 15 minutes and can be used once.</p><p v-if="error" class="error" role="alert">{{ error }}</p><small>Already using Xaylo inside HighLevel? Open it from your location’s menu.</small><a class="guide-link" href="/guide">How Xaylo works & setup guide →</a></section></template>
<style scoped>.access{max-width:540px;margin:8vh auto;padding:35px;background:#171827;border:1px solid #303144;border-radius:16px}.access>span{font-size:11px;letter-spacing:.2em;color:#e8b923}h1{font-size:36px}p{color:#b9bdd0;line-height:1.7}label{display:block;color:#b9bdd0;font-size:13px}input{display:block;width:100%;margin:9px 0 18px;padding:13px;background:#10111d;color:#fff;border:1px solid #3a3d54;border-radius:8px;font:inherit}button{width:100%;padding:13px;border:0;border-radius:8px;background:#e8b923;font-weight:700;cursor:pointer}small{display:block;margin-top:25px;color:#989fb8;line-height:1.6}.error{color:#ffb9bc}</style>

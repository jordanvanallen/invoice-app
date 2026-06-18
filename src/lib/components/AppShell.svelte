<script lang="ts">
  import { page } from '$app/stores';
  import { settings } from '$lib/stores/settings';
  import { lastBackupAt, backupFailed } from '$lib/stores/backup';
  let { children } = $props();
  const nav = [
    { href: '/', label: 'New Invoice' },
    { href: '/history', label: 'History' },
    { href: '/clients', label: 'Clients' },
    { href: '/locations', label: 'Locations' },
    { href: '/backups', label: 'Backups' },
    { href: '/settings', label: 'Settings' },
  ];
  const isActive = (href: string, path: string) =>
    href === '/' ? path === '/' : path.startsWith(href);
</script>

<div class="shell">
  <nav>
    <ul>
      {#each nav as item}
        <li>
          <a href={item.href} class:active={isActive(item.href, $page.url.pathname)}>{item.label}</a>
        </li>
      {/each}
    </ul>
    <div class="rail-footer">
      <div class="who">{$settings?.inspectorName || 'Set up your details →'}</div>
      <div class="bk" class:warn={$backupFailed}>
        {#if $backupFailed}⚠ Backup failed{:else if $lastBackupAt}✓ Backed up {$lastBackupAt}{:else}Backs up on save{/if}
      </div>
    </div>
  </nav>
  <main>{@render children()}</main>
</div>

<style>
  /* Pin the shell to the viewport so the sidebar stays fixed and only main scrolls.
     The rail width scales with text size so labels don't wrap at Large/Extra-large. */
  .shell { display:grid; grid-template-columns:calc(220px * var(--fs-scale)) 1fr; height:100vh; overflow:hidden; }
  nav { background:var(--bg-surface); border-right:1px solid var(--border); display:flex; flex-direction:column; min-height:0; }
  ul { list-style:none; margin:0; padding:var(--sp-3); flex:1; min-height:0; overflow-y:auto; }
  li { margin-bottom:var(--sp-1); }
  a {
    display:flex; align-items:center; min-height:calc(56px * var(--fs-scale)); padding:0 var(--sp-4);
    border-radius:var(--r-sm); color:var(--text-primary); text-decoration:none;
    font-size:var(--fs-base); border-left:4px solid transparent; white-space:nowrap;
  }
  a:hover { background:var(--bg-sunken); }
  a.active { background:var(--accent-tint); border-left-color:var(--accent); color:var(--accent-strong); font-weight:600; }
  .rail-footer { padding:var(--sp-4); border-top:1px solid var(--border); display:flex; flex-direction:column; gap:2px; }
  .rail-footer .who { color:var(--text-secondary); font-size:var(--fs-sm); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .rail-footer .bk { color:var(--text-muted); font-size:var(--fs-xs); }
  .rail-footer .bk.warn { color:var(--amber-600); }
  main { padding:var(--sp-8); overflow:auto; }
</style>

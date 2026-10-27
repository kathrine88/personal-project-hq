// Geometry checks on the real application DOM, with local fixture data only.
const assert = require('node:assert/strict');
module.exports = async function checkMobileLayout(page, view) {
  for (const width of [320,375,390,430,768,1440]) {
    await page.setViewportSize({width,height:844});
    const problems = await page.evaluate(view => {
      const problems = [];
      const visible = n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
      const rect = n => n.getBoundingClientRect();
      const overlap = (a,b) => a.left < b.right-.5 && b.left < a.right-.5 && a.top < b.bottom-.5 && b.top < a.bottom-.5;
      if(document.documentElement.scrollWidth > innerWidth) problems.push('horizontal overflow');
      const root = document.querySelector(view);
      const groups = [document.querySelector('.view-nav'),root.querySelector('.coming-toolbar')].filter(Boolean);
      for(const group of groups) {
        const controls = [...group.querySelectorAll('a,button')].filter(visible);
        for(const [i,n] of controls.entries()) {
          const box = rect(n);
          if(box.width < 43.5 || box.height < 43.5) problems.push('small target: '+(n.getAttribute('aria-label')||n.textContent));
          for(const other of controls.slice(i+1)) if(overlap(box,rect(other))) problems.push('overlapping controls');
        }
      }
      for(const n of root.querySelectorAll('.coming-control,.coming-check,.day-add,.week-edit,.drag-handle')) {
        if(visible(n) && (rect(n).width < 43.5 || rect(n).height < 43.5)) problems.push('small card/planner action');
      }
      for(const n of root.querySelectorAll('.coming-card:has(.coming-check) h3')) {
        const check = n.parentElement.querySelector('.coming-check');
        const text = document.createRange();text.selectNodeContents(n);
        if(overlap(text.getBoundingClientRect(),rect(check))) problems.push('checkbox obscures title');
      }
      const feedback = root.querySelector('.coming-feedback');
      if(feedback?.querySelector('p:empty') && visible(feedback)) problems.push('empty feedback row');
      const reload = root.querySelector('.compact-reload');
      if(reload && !reload.closest('.coming-toolbar')) problems.push('separate reload row');
      return problems;
    }, view);
    assert.deepEqual(problems,[],view+' at '+width+'px');
  }
  await page.setViewportSize({width:390,height:844});
};

fetch('/catalog/abc'); // simple-template
fetch('/catalog/a?trace=1'); // query-template
fetch('/catalog/a/'); // trailing-template
fetch('/catalog/a/details'); // longer-template
fetch('/catalog/a/b'); // reject-multiple-segments
fetch('/numbers/nope'); // regex-stays-unknown

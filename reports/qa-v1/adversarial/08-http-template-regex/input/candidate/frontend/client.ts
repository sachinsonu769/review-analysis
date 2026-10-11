fetch('/numeric/123'); // valid-template
fetch('/numeric/nope'); // excluded-by-regex
fetch('https://other.example/numeric/123'); // unknown-origin

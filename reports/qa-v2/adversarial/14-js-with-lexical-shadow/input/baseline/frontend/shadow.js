with ({fetch: () => null}) {
 fetch('/audit/fake'); // with-object-shadow
}
fetch('/audit/real'); // outside-with-control

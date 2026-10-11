package qa;
class Caller {
 Target target;
 void use() { target.run(1); } // wrong-arity
}